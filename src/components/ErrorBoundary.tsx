import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      let friendly = 'حدث خطأ غير متوقع في النظام.';
      if (this.state.message.includes('Missing or insufficient permissions')) {
        friendly = 'ليس لديك صلاحية كافية لتنفيذ هذه العملية أو الوصول إلى هذه البيانات.';
      } else if (this.state.message.includes('Quota exceeded')) {
        friendly = 'تم تجاوز حصة القراءة اليومية المجانية لقاعدة البيانات.';
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full space-y-4 text-center">
            <h2 className="text-lg font-bold text-red-700">تنبيه النظام</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{friendly}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl cursor-pointer"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
