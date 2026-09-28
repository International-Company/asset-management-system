import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card">
      <h1>الصفحة غير موجودة</h1>
      <p className="muted">الرابط الذي فتحته غير صحيح أو لم يعد متاحًا.</p>
      <Link to="/">العودة إلى الرئيسية</Link>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="card">
      <h1>لا تملك صلاحية الوصول</h1>
      <p className="muted">ليست لديك الصلاحية اللازمة لعرض هذه الصفحة. تواصل مع مدير النظام إذا كنت تحتاجها.</p>
      <Link to="/">العودة إلى الرئيسية</Link>
    </div>
  );
}

export function ServerErrorPage() {
  return (
    <div className="center-page">
      <div className="card center-card">
        <h1>حدث خطأ غير متوقع</h1>
        <p className="muted">تعذر عرض هذه الصفحة. يرجى تحديث الصفحة أو المحاولة لاحقًا.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          تحديث الصفحة
        </button>
      </div>
    </div>
  );
}
