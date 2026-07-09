import { PAGES } from '../router';
import type { Page } from '../router';
import { useProjects } from '../ProjectContext';

export function Sidebar({ currentPage }: { currentPage: Page }) {
  const { currentProject } = useProjects();

  return (
    <nav className="sidebar" aria-label="主要導覽">
      <div className="sidebar-header">
        <div className="sidebar-brand">MemoryCastle</div>
        <div className="sidebar-project">{currentProject ? currentProject.name : '尚未選擇專案'}</div>
      </div>
      <ul className="sidebar-nav">
        {PAGES.map(({ page, label }) => (
          <li key={page}>
            <a href={`#/${page}`} className={page === currentPage ? 'sidebar-link active' : 'sidebar-link'}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
