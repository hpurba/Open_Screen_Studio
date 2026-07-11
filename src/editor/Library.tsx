import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "../shared/types";
import { BrandMark, Icon } from "./icons";
import { projectStore } from "./storageAdapter";
import { formatDate, formatDuration, safeHost } from "./utils";

type LibraryProps = { onOpenProject: (id: string) => void };

export function Library({ onOpenProject }: LibraryProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectSummary | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await projectStore.list());
    } catch {
      setError("Your local project library could not be opened.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        project.title.toLowerCase().includes(needle) ||
        safeHost(project.sourceUrl).toLowerCase().includes(needle),
    );
  }, [projects, query]);

  const removeProject = async () => {
    if (!deleteCandidate) return;
    try {
      await projectStore.delete(deleteCandidate.id);
      setProjects((current) => current.filter((project) => project.id !== deleteCandidate.id));
      setDeleteCandidate(null);
    } catch {
      setError("That project could not be deleted. Try again.");
    }
  };

  return (
    <div className="library-page">
      <header className="library-header">
        <a className="brand" href="#/" aria-label="Open Screen Studio home">
          <BrandMark size={32} />
          <span>Open Screen Studio</span>
        </a>
        <div className="library-header-actions">
          <button className="button" onClick={() => setShowGuide(true)}>
            <Icon name="info" size={16} /> How it works
          </button>
          <button className="primary-button" onClick={() => setShowGuide(true)}>
            <span className="record-dot" /> New recording
          </button>
        </div>
      </header>

      <main className="library-main">
        <section className="library-hero">
          <div>
            <span className="eyebrow"><Icon name="sparkles" size={14} /> Local-first screen recorder</span>
            <h1>Your recordings</h1>
            <p>Turn Chrome tabs into focused product demos with smooth camera movement and an editable cursor.</p>
          </div>
          {projects.length > 0 && (
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" />
            </label>
          )}
        </section>

        {error && <div className="library-alert" role="alert"><Icon name="info" size={17} /><span>{error}</span><button onClick={() => void load()}>Retry</button></div>}

        {loading ? (
          <div className="project-grid" aria-label="Loading projects">
            {[0, 1, 2].map((item) => <div className="project-card skeleton" key={item}><div /><span /><i /></div>)}
          </div>
        ) : projects.length === 0 ? (
          <section className="empty-library">
            <div className="empty-visual" aria-hidden="true">
              <div className="mini-browser"><span /><span /><span /><i /></div>
              <div className="floating-cursor">↖</div>
              <div className="floating-zoom">1.8×</div>
            </div>
            <span className="eyebrow">Ready when you are</span>
            <h2>Record your first polished demo</h2>
            <p>Only the active website is captured—never Chrome’s tabs or address bar. Every zoom and cursor choice stays editable.</p>
            <button className="primary-button large" onClick={() => setShowGuide(true)}><span className="record-dot" /> Start a recording</button>
            <div className="feature-row">
              <span><Icon name="frame" size={15} /> Website only</span>
              <span><Icon name="zoom-in" size={15} /> Automatic zoom</span>
              <span><Icon name="eye-off" size={15} /> Hide cursor later</span>
            </div>
          </section>
        ) : visibleProjects.length === 0 ? (
          <section className="no-results"><Icon name="folder" size={26} /><h2>No matching projects</h2><p>Try a different title or website.</p><button className="button" onClick={() => setQuery("")}>Clear search</button></section>
        ) : (
          <section className="project-grid" aria-label="Projects">
            {visibleProjects.map((project, index) => (
              <article className="project-card" key={project.id}>
                <button className="project-preview" onClick={() => onOpenProject(project.id)} aria-label={`Open ${project.title}`}>
                  <div className={`project-art art-${index % 4}`}>
                    <div className="project-browser"><span /><span /><span /><div><i /><i /><i /></div></div>
                    <span className="project-play"><Icon name="play" size={18} /></span>
                  </div>
                  <span className="duration-badge">{formatDuration(project.duration)}</span>
                </button>
                <div className="project-meta">
                  <button className="project-open" onClick={() => onOpenProject(project.id)}>
                    <strong>{project.title || "Untitled recording"}</strong>
                    <span>{safeHost(project.sourceUrl)} · {formatDate(project.updatedAt)}</span>
                  </button>
                  <button className="icon-button project-delete" onClick={() => setDeleteCandidate(project)} aria-label={`Delete ${project.title}`} title="Delete project"><Icon name="trash" size={16} /></button>
                </div>
              </article>
            ))}
            <button className="new-project-card" onClick={() => setShowGuide(true)}><span><Icon name="plus" size={20} /></span><strong>New recording</strong><small>Capture another Chrome tab</small></button>
          </section>
        )}
      </main>

      <footer className="library-footer"><span>Private by design · Stored on this device</span><span>Open source · No account required</span></footer>

      {showGuide && (
        <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && setShowGuide(false)}>
          <section className="modal recording-guide" role="dialog" aria-modal="true" aria-labelledby="record-guide-title">
            <button className="modal-close" onClick={() => setShowGuide(false)} aria-label="Close">×</button>
            <div className="modal-icon"><span className="record-dot" /></div>
            <span className="eyebrow">Capture a website</span>
            <h2 id="record-guide-title">Start from the Chrome toolbar</h2>
            <p>Open the website you want to demonstrate, then click the Open Screen Studio extension icon.</p>
            <ol className="recording-steps">
              <li><span>1</span><div><strong>Open any normal website</strong><small>The visible page content is captured without browser chrome.</small></div></li>
              <li><span>2</span><div><strong>Click the extension icon</strong><small>Pin it from Chrome’s Extensions menu if it is hidden.</small></div></li>
              <li><span>3</span><div><strong>Click again when finished</strong><small>This editor opens automatically with your recording.</small></div></li>
            </ol>
            <div className="shortcut-callout"><kbd>{navigator.userAgent.includes("Mac") ? "⌃" : "Alt"}</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>R</kbd><small>Keyboard shortcut</small></div>
            <button className="primary-button button-wide" onClick={() => setShowGuide(false)}>Got it</button>
          </section>
        </div>
      )}

      {deleteCandidate && (
        <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && setDeleteCandidate(null)}>
          <section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="danger-icon"><Icon name="trash" /></div>
            <h2 id="delete-title">Delete “{deleteCandidate.title}”?</h2>
            <p>The source recording and all edits will be removed from this device. This cannot be undone.</p>
            <div className="modal-actions"><button className="button" onClick={() => setDeleteCandidate(null)}>Cancel</button><button className="danger-button filled" onClick={() => void removeProject()}>Delete project</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
