import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from '../firebase';
import {
  registerOrHeartbeatDevice,
  renameDeviceRecord,
  type ActorInfo,
} from '../services/accountingService';
import {
  ADMIN_PERMISSIONS,
  DEFAULT_EMPLOYEE_PERMISSIONS,
  type DeviceRecord,
  type StaffInvite,
  type UserProfile,
} from '../types';
import {
  getLocalDeviceIdentity,
  saveDeviceName,
  type DetectedDeviceMetadata,
} from '../utils/device';
import { truncateText } from '../utils/format';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signingIn: boolean;
  authError: string | null;
  isAdmin: boolean;
  isActiveStaff: boolean;
  deviceIdentity: DetectedDeviceMetadata;
  deviceRecord: DeviceRecord | null;
  isDeviceBlocked: boolean;
  actorInfo: ActorInfo | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (perm: keyof UserProfile['permissions']) => boolean;
  updateCurrentDeviceName: (name: string) => Promise<void>;
  ensureDeviceRegistered: () => Promise<DeviceRecord | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deviceIdentity, setDeviceIdentity] = useState<DetectedDeviceMetadata>(() =>
    getLocalDeviceIdentity()
  );
  const [deviceRecord, setDeviceRecord] = useState<DeviceRecord | null>(null);
  const registeredSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    testConnection();
    if (!Capacitor.isNativePlatform()) {
      getRedirectResult(auth).catch((err) => {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/unauthorized-domain') {
          setAuthError('النطاق غير مصرح به في إعدادات Firebase Auth.');
        } else if (code && code !== 'auth/popup-closed-by-user') {
          setAuthError('تعذر إتمام تسجيل الدخول عبر Google. يرجى المحاولة مرة أخرى.');
        }
      });
    }
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubDevice: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubDevice) {
        unsubDevice();
        unsubDevice = null;
      }
      registeredSessionKeyRef.current = null;

      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setProfile(null);
        setDeviceRecord(null);
        setLoading(false);
        return;
      }

      if (!user.emailVerified) {
        setAuthError('يرجى استخدام حساب بريد إلكتروني موثق (Google Verified).');
        setProfile(null);
        setDeviceRecord(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        const isBootstrap =
          user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

        let resolvedRole: UserProfile['role'] = 'pending';
        let resolvedStatus: UserProfile['status'] = 'pending';
        let resolvedName = user.displayName || user.email || 'مستخدم جديد';

        if (!userSnap.exists()) {
          // Check if there is an active staff invite for this email (case-insensitive)
          let matchedInvite: (StaffInvite & { id: string }) | null = null;
          if (!isBootstrap && user.email) {
            try {
              const lowerEmail = user.email.trim().toLowerCase();
              let inviteSnaps = await getDocs(
                query(collection(db, 'staff_invites'), where('email', '==', lowerEmail))
              );
              if (inviteSnaps.empty && lowerEmail !== user.email) {
                inviteSnaps = await getDocs(
                  query(collection(db, 'staff_invites'), where('email', '==', user.email))
                );
              }
              const activeInv = inviteSnaps.docs.find(
                (d) => d.data().status === 'active'
              );
              if (activeInv) {
                matchedInvite = {
                  id: activeInv.id,
                  ...(activeInv.data() as Omit<StaffInvite, 'id'>),
                };
              }
            } catch {
              // No invite found or permission check
            }
          }

          const displayName = truncateText(
            matchedInvite?.name || user.displayName || user.email || 'مستخدم جديد',
            120
          );
          resolvedName = displayName;

          if (isBootstrap) {
            resolvedRole = 'admin';
            resolvedStatus = 'active';
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email || BOOTSTRAP_ADMIN_EMAIL,
              displayName,
              role: 'admin',
              status: 'active',
              permissions: ADMIN_PERMISSIONS,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'admins', user.uid), {
              uid: user.uid,
              email: user.email || BOOTSTRAP_ADMIN_EMAIL,
              createdAt: serverTimestamp(),
            });
          } else if (matchedInvite) {
            resolvedRole = matchedInvite.role;
            resolvedStatus = 'active';
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email || '',
              displayName,
              role: matchedInvite.role,
              status: 'active',
              permissions: matchedInvite.permissions,
              inviteId: matchedInvite.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email || '',
              displayName,
              role: 'pending',
              status: 'pending',
              permissions: DEFAULT_EMPLOYEE_PERMISSIONS,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          const existingData = userSnap.data() as Omit<UserProfile, 'id'>;
          resolvedRole = existingData.role;
          resolvedStatus = existingData.status;
          resolvedName = existingData.displayName || resolvedName;

          if (isBootstrap) {
            resolvedRole = 'admin';
            resolvedStatus = 'active';
            const adminMarkerSnap = await getDoc(doc(db, 'admins', user.uid));
            if (!adminMarkerSnap.exists()) {
              await setDoc(doc(db, 'admins', user.uid), {
                uid: user.uid,
                email: user.email || BOOTSTRAP_ADMIN_EMAIL,
                createdAt: serverTimestamp(),
              });
            }
          }
        }

        // Ensure default store settings and counters exist when bootstrap admin signs in
        if (isBootstrap) {
          const settingsRef = doc(db, 'settings', 'store');
          const settingsSnap = await getDoc(settingsRef);
          if (!settingsSnap.exists()) {
            await setDoc(settingsRef, {
              storeName: 'بقالة الحسام',
              phone: '',
              address: '',
              currency: 'ر.ي',
              receiptFooter: 'شكراً لتعاملكم مع بقالة الحسام',
              updatedAt: serverTimestamp(),
            });
          } else if (settingsSnap.data().currency === 'ر.س') {
            await updateDoc(settingsRef, {
              currency: 'ر.ي',
              updatedAt: serverTimestamp(),
            });
          }
          const countersRef = doc(db, 'counters', 'main');
          const countersSnap = await getDoc(countersRef);
          if (!countersSnap.exists()) {
            await setDoc(countersRef, {
              nextProductSeq: 1001,
              nextCustomerSeq: 1001,
              nextSupplierSeq: 1001,
              nextInvoiceSeq: 1,
              nextPurchaseSeq: 1,
              nextReturnSeq: 1,
              nextVoucherSeq: 1,
              cashBalance: 0,
              updatedAt: serverTimestamp(),
            });
          }
        }

        const currentDev = getLocalDeviceIdentity();
        setDeviceIdentity(currentDev);

        const activeOnLogin =
          isBootstrap ||
          (resolvedStatus === 'active' &&
            (resolvedRole === 'admin' || resolvedRole === 'employee'));

        if (activeOnLogin) {
          const roleForDev: 'admin' | 'employee' =
            isBootstrap || resolvedRole === 'admin' ? 'admin' : 'employee';
          registeredSessionKeyRef.current = `${user.uid}:${roleForDev}`;
          const reg = await registerOrHeartbeatDevice({
            deviceId: currentDev.deviceId,
            deviceName: currentDev.deviceName,
            deviceType: currentDev.deviceType,
            platform: currentDev.platform,
            userId: user.uid,
            userName: resolvedName,
            userEmail: user.email || 'staff@local',
            userRole: roleForDev,
          });
          if (reg) {
            setDeviceRecord(reg);
            if (reg.deviceName && reg.deviceName !== currentDev.deviceName) {
              const syncedName = saveDeviceName(reg.deviceName);
              setDeviceIdentity((prev) => ({ ...prev, deviceName: syncedName }));
            }
          }
        }

        // Listen to current device status in real time (so admin remote block applies immediately)
        unsubDevice = onSnapshot(
          doc(db, 'devices', currentDev.deviceId),
          (devSnap) => {
            if (devSnap.exists()) {
              const d = {
                id: devSnap.id,
                ...(devSnap.data() as Omit<DeviceRecord, 'id'>),
              };
              setDeviceRecord(d);
              if (d.deviceName) {
                const synced = saveDeviceName(d.deviceName);
                setDeviceIdentity((prev) =>
                  prev.deviceName === synced ? prev : { ...prev, deviceName: synced }
                );
              }
            } else {
              setDeviceRecord(null);
            }
          },
          () => {
            // Ignore device listener transient errors when pending or offline
          }
        );

        // Listen to user's own profile document in real time
        unsubProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as Omit<UserProfile, 'id'>;
              setProfile({ id: snap.id, ...data });
            } else {
              setProfile(null);
            }
            setLoading(false);
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
          }
        );
      } catch (err) {
        console.error('Auth bootstrap error:', err);
        setAuthError('حدث خطأ أثناء تهيئة الحساب. يرجى المحاولة مرة أخرى.');
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubDevice) unsubDevice();
    };
  }, []);

  const isAdmin =
    Boolean(profile && profile.role === 'admin' && profile.status === 'active') ||
    Boolean(
      firebaseUser?.emailVerified &&
        firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
    );

  const isActiveStaff =
    isAdmin ||
    Boolean(
      profile &&
        profile.status === 'active' &&
        (profile.role === 'admin' || profile.role === 'employee')
    );

  // If a pending employee gets approved while waiting on LoginView, register their device automatically
  useEffect(() => {
    if (!firebaseUser || !isActiveStaff) return;
    const roleForDev: 'admin' | 'employee' = isAdmin ? 'admin' : 'employee';
    const sessionKey = `${firebaseUser.uid}:${roleForDev}`;
    if (registeredSessionKeyRef.current === sessionKey) return;
    registeredSessionKeyRef.current = sessionKey;

    const dev = getLocalDeviceIdentity();
    registerOrHeartbeatDevice({
      deviceId: dev.deviceId,
      deviceName: dev.deviceName,
      deviceType: dev.deviceType,
      platform: dev.platform,
      userId: firebaseUser.uid,
      userName: profile?.displayName || firebaseUser.displayName || firebaseUser.email || 'موظف',
      userEmail: firebaseUser.email || 'staff@local',
      userRole: roleForDev,
    })
      .then((reg) => {
        if (reg) setDeviceRecord(reg);
      })
      .catch(() => {
        // Handled on next reconnect
      });
  }, [firebaseUser, isActiveStaff, isAdmin, profile?.displayName]);

  const ensureDeviceRegistered = useCallback(async (): Promise<DeviceRecord | null> => {
    if (!firebaseUser || !isActiveStaff) return null;
    const dev = getLocalDeviceIdentity();
    const roleForDev: 'admin' | 'employee' = isAdmin ? 'admin' : 'employee';
    const reg = await registerOrHeartbeatDevice({
      deviceId: dev.deviceId,
      deviceName: deviceIdentity.deviceName || dev.deviceName,
      deviceType: dev.deviceType,
      platform: dev.platform,
      userId: firebaseUser.uid,
      userName: profile?.displayName || firebaseUser.displayName || firebaseUser.email || 'موظف',
      userEmail: firebaseUser.email || 'staff@local',
      userRole: roleForDev,
    });
    if (reg) setDeviceRecord(reg);
    return reg;
  }, [firebaseUser, isActiveStaff, isAdmin, profile?.displayName, deviceIdentity.deviceName]);

  const actorInfo = useMemo<ActorInfo | null>(() => {
    if (!firebaseUser || !isActiveStaff) return null;
    return {
      uid: firebaseUser.uid,
      name: profile?.displayName || firebaseUser.displayName || firebaseUser.email || 'موظف',
      role: isAdmin ? 'admin' : 'employee',
      deviceId: deviceIdentity.deviceId,
      deviceName: deviceRecord?.deviceName || deviceIdentity.deviceName,
    };
  }, [firebaseUser, isActiveStaff, isAdmin, profile?.displayName, deviceIdentity, deviceRecord?.deviceName]);

  const updateCurrentDeviceName = useCallback(
    async (newName: string) => {
      const saved = saveDeviceName(newName);
      setDeviceIdentity((prev) => ({ ...prev, deviceName: saved }));
      if (actorInfo && isActiveStaff && deviceRecord) {
        await renameDeviceRecord(actorInfo, deviceIdentity.deviceId, saved, {
          isActiveStaff,
        });
      }
    },
    [actorInfo, isActiveStaff, deviceRecord, deviceIdentity.deviceId]
  );

  const signInWithGoogle = async () => {
    if (signingIn) return;
    setAuthError(null);
    setSigningIn(true);

    try {
      if (Capacitor.isNativePlatform()) {
        let idToken: string | undefined;
        try {
          const res = await FirebaseAuthentication.signInWithGoogle({
            skipNativeAuth: true,
            useCredentialManager: true,
          });
          idToken = res.credential?.idToken;
        } catch (cmErr) {
          const cmMsg = cmErr instanceof Error ? cmErr.message : String(cmErr);
          const cmCode = String((cmErr as { code?: string | number })?.code || '');
          const isUserCanceled =
            /cancel|12501|UserCanceled/i.test(cmMsg) || cmCode === '12501';
          if (isUserCanceled) {
            return;
          }
          // Fallback to legacy Google Sign-In client if Credential Manager is unavailable on this device
          const fallbackRes = await FirebaseAuthentication.signInWithGoogle({
            skipNativeAuth: true,
            useCredentialManager: false,
          });
          idToken = fallbackRes.credential?.idToken;
        }

        if (!idToken) {
          setAuthError(
            'لم يُعد مزود Google رمز التحقق (ID Token). تأكد من مطابقة Web Client ID وملف google-services.json.'
          );
          return;
        }

        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
        return;
      }

      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        const msg = err instanceof Error ? err.message : String(err);
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment'
        ) {
          try {
            await signInWithRedirect(auth, googleProvider);
            return;
          } catch {
            setAuthError('تعذر تسجيل الدخول عبر Google. يرجى المحاولة مرة أخرى.');
            return;
          }
        }
        if (!msg.includes('popup-closed-by-user')) {
          setAuthError('تعذر تسجيل الدخول عبر Google. يرجى التحقق من السماح بالنوافذ المنبثقة.');
        }
      }
    } catch (err) {
      const code = String((err as { code?: string | number })?.code || '');
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel|12501|UserCanceled/i.test(msg) || code === '12501') {
        return;
      }
      if (/10:|DEVELOPER_ERROR|12500/i.test(msg) || code === '10' || code === '12500') {
        setAuthError(
          'فشل تحقق OAuth على Android (خطأ DEVELOPER_ERROR): تأكد من تسجيل بصمة SHA-1 وSHA-256 واسم الحزمة com.alhussam.grocery في Firebase Console وتضمين google-services.json.'
        );
      } else if (/NoCredentialException|no credentials available/i.test(msg)) {
        setAuthError(
          'لا يوجد حساب Google متاح أو فشل التحقق من إعدادات OAuth (تأكد من وجود حساب Google على الهاتف ومن مطابقة SHA-1 في Firebase).'
        );
      } else if (/network|NETWORK_ERROR|7:/i.test(msg) || code === 'auth/network-request-failed') {
        setAuthError('تعذر الاتصال بالإنترنت. يرجى التحقق من الشبكة والمحاولة مرة أخرى.');
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError('تسجيل الدخول عبر Google غير مفعّل في Firebase Authentication.');
      } else {
        setAuthError(`تعذر إتمام تسجيل الدخول عبر Google (${code || msg || 'خطأ غير معروف'}).`);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    if (Capacitor.isNativePlatform()) {
      await FirebaseAuthentication.signOut().catch(() => {});
    }
    await signOut(auth);
  };

  const hasPermission = (perm: keyof UserProfile['permissions']): boolean => {
    if (isAdmin) return true;
    if (!isActiveStaff || !profile) return false;
    return Boolean(profile.permissions?.[perm]);
  };

  const isDeviceBlocked = deviceRecord?.status === 'blocked';

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        signingIn,
        authError,
        isAdmin,
        isActiveStaff,
        deviceIdentity,
        deviceRecord,
        isDeviceBlocked,
        actorInfo,
        signInWithGoogle,
        logout,
        hasPermission,
        updateCurrentDeviceName,
        ensureDeviceRegistered,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
