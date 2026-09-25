import { Navigate, Route, Routes } from "react-router-dom";
import { TeachingAuthProvider } from "./auth/teaching-auth-provider";
import { TeachingAccessRoute } from "./auth/teaching-access-route";
import { TeachingLayout } from "./layout/teaching-layout";
import { TeachingDashboardPage } from "./pages/teaching-dashboard-page";
import { TeachingLoginPage } from "./pages/teaching-login-page";
import { TeachingImportPage } from "./pages/teaching-import-page";
import { TeachingQuestionEditorPage } from "./pages/teaching-question-editor-page";
import { TeachingQuestionListPage } from "./pages/teaching-question-list-page";
import { TeachingImportBatchPage } from "./pages/teaching-import-batch-page";
import { TeachingAccessDenied } from "./components/teaching-access-denied";
import { useTeachingAuth } from "./auth/teaching-auth-context";

function TeachingDashboardRoute() {
  return (
    <TeachingAccessRoute>
      <TeachingLayout>
        <TeachingDashboardPage />
      </TeachingLayout>
    </TeachingAccessRoute>
  );
}

function TeachingImportRoute() {
  return (
    <TeachingAccessRoute requiredPermission="teaching.author">
      <TeachingLayout>
        <TeachingImportPage />
      </TeachingLayout>
    </TeachingAccessRoute>
  );
}

function TeachingEditorialCapabilityRoute({ children }: { children: React.ReactNode }) {
  const { identity } = useTeachingAuth();
  const canManageEditorial = Boolean(identity?.permissions.some((permission) =>
    ["teaching.author", "teaching.review", "teaching.publish", "teaching.admin"].includes(permission),
  ));
  if (!canManageEditorial) return <TeachingAccessDenied capability="Teaching editorial access" />;
  return <TeachingLayout>{children}</TeachingLayout>;
}

function TeachingEditorialRoute({ children }: { children: React.ReactNode }) {
  return (
    <TeachingAccessRoute>
      <TeachingEditorialCapabilityRoute>{children}</TeachingEditorialCapabilityRoute>
    </TeachingAccessRoute>
  );
}

export function TeachingApplication() {
  return (
    <TeachingAuthProvider>
      <Routes>
        <Route path="login" element={<TeachingLoginPage />} />
        <Route index element={<Navigate to="/teaching/dashboard" replace />} />
        <Route path="dashboard" element={<TeachingDashboardRoute />} />
        <Route path="admin/import" element={<TeachingImportRoute />} />
        <Route path="admin/import/batches/:batchId" element={<TeachingEditorialRoute><TeachingImportBatchPage /></TeachingEditorialRoute>} />
        <Route path="admin/questions" element={<TeachingEditorialRoute><TeachingQuestionListPage /></TeachingEditorialRoute>} />
        <Route path="admin/questions/new" element={<TeachingEditorialRoute><TeachingQuestionEditorPage /></TeachingEditorialRoute>} />
        <Route path="admin/questions/:id" element={<TeachingEditorialRoute><TeachingQuestionEditorPage /></TeachingEditorialRoute>} />
        <Route path="*" element={<Navigate to="/teaching" replace />} />
      </Routes>
    </TeachingAuthProvider>
  );
}
