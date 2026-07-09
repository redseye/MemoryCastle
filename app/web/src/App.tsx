import { ProjectProvider } from './ProjectContext';
import { Sidebar } from './components/Sidebar';
import { useHashRoute } from './router';
import { DashboardPage } from './pages/DashboardPage';
import { KeepPage } from './pages/KeepPage';
import { ChroniclePage } from './pages/ChroniclePage';
import { RoomsPage } from './pages/RoomsPage';
import { RoutesPage } from './pages/RoutesPage';
import { PatrolPage } from './pages/PatrolPage';
import { ImportPage } from './pages/ImportPage';
import { SettingsPage } from './pages/SettingsPage';

function PageBody() {
  const { page, param } = useHashRoute();
  switch (page) {
    case 'dashboard':
      return <DashboardPage />;
    case 'keep':
      return <KeepPage />;
    case 'chronicle':
      return <ChroniclePage />;
    case 'rooms':
      return <RoomsPage slug={param} />;
    case 'routes':
      return <RoutesPage />;
    case 'patrol':
      return <PatrolPage />;
    case 'import':
      return <ImportPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <DashboardPage />;
  }
}

export default function App() {
  const { page } = useHashRoute();
  return (
    <ProjectProvider>
      <div className="app-shell">
        <Sidebar currentPage={page} />
        <main className="main-content">
          <PageBody />
        </main>
      </div>
    </ProjectProvider>
  );
}
