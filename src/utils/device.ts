import type { DeviceType } from '../types';
import { truncateText } from './format';

const DEVICE_ID_STORAGE_KEY = 'alhussam_device_id_v1';
const DEVICE_NAME_STORAGE_KEY = 'alhussam_device_name_v1';

export interface DetectedDeviceMetadata {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
}

export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{6,128}$/.test(existing)) {
      return existing;
    }
    const rand = Math.random().toString(36).slice(2, 10);
    const created = `dev_${Date.now().toString(36)}_${rand}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `dev_${Date.now().toString(36)}_temp`;
  }
}

export function detectPlatformInfo(): {
  deviceType: DeviceType;
  platform: string;
  defaultDeviceName: string;
} {
  if (typeof navigator === 'undefined') {
    return {
      deviceType: 'desktop',
      platform: 'كمبيوتر',
      defaultDeviceName: 'جهاز الكاشير',
    };
  }

  const ua = navigator.userAgent || '';
  const isIpad =
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const isIphone = /iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isTablet = isIpad || (isAndroid && !/Mobile/i.test(ua));
  const isMobile = isIphone || (isAndroid && /Mobile/i.test(ua));

  const deviceType: DeviceType = isTablet
    ? 'tablet'
    : isMobile
    ? 'mobile'
    : 'desktop';

  let os = 'نظام غير معروف';
  if (isIphone) os = 'iPhone';
  else if (isIpad) os = 'iPad';
  else if (isAndroid) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'متصفح';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/OPR|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  const typeLabel =
    deviceType === 'mobile' ? 'هاتف' : deviceType === 'tablet' ? 'تابلت' : 'كمبيوتر';

  return {
    deviceType,
    platform: truncateText(`${os} · ${browser}`, 120),
    defaultDeviceName: truncateText(`${typeLabel} ${os}`, 120),
  };
}

export function getSavedDeviceName(fallback: string): string {
  try {
    const saved = localStorage.getItem(DEVICE_NAME_STORAGE_KEY);
    if (saved && saved.trim()) {
      return truncateText(saved, 120);
    }
  } catch {
    // ignore storage failures
  }
  return truncateText(fallback, 120);
}

export function saveDeviceName(name: string): string {
  const clean = truncateText(name, 120) || 'جهاز كاشير';
  try {
    localStorage.setItem(DEVICE_NAME_STORAGE_KEY, clean);
  } catch {
    // ignore storage failures
  }
  return clean;
}

export function getLocalDeviceIdentity(): DetectedDeviceMetadata {
  const deviceId = getOrCreateDeviceId();
  const meta = detectPlatformInfo();
  const deviceName = getSavedDeviceName(meta.defaultDeviceName);
  return {
    deviceId,
    deviceName,
    deviceType: meta.deviceType,
    platform: meta.platform,
  };
}

export function deviceTypeLabel(type: DeviceType): string {
  switch (type) {
    case 'mobile':
      return 'هاتف جوال';
    case 'tablet':
      return 'جهاز لوحي';
    case 'desktop':
      return 'كمبيوتر';
  }
}
