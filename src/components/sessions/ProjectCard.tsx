import React from 'react';
import { SessionProject } from '../../types/session';
import { formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';
import { Folder } from 'lucide-react';

interface ProjectCardProps {
  project: SessionProject;
  onOpen: (project: SessionProject) => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen }) => {
  return (
    <button
      type="button"
      data-no-press
      onClick={() => onOpen(project)}
      title={project.path}
      className="bento-card group flex min-h-[128px] min-w-0 cursor-pointer flex-col overflow-hidden text-left outline-none transition-colors hover:bg-[var(--hover)] focus-visible:ring-2 focus-visible:ring-ring/25"
    >
      <div className="flex w-full min-w-0 items-start gap-3.5 px-5 pt-5 pb-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--button-fill)] text-muted-foreground">
          <Folder size={18} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate text-title font-semibold tracking-[-0.01em] text-foreground">
            {project.name}
          </h3>
          <p className="mt-1 truncate font-mono text-caption text-[var(--label)]">{project.path}</p>
        </div>
      </div>

      <div className="mt-auto flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--hairline-divider)] px-5 py-3">
        <div className="flex shrink-0 items-center gap-2 text-label text-muted-foreground">
          <span>
            会话 <span className="font-semibold text-foreground tabular-nums">{project.sessionCount}</span>
          </span>
          {project.totalTokens > 0 && (
            <>
              <span className="text-[var(--label)]">·</span>
              <span>
                <span className="font-semibold text-foreground tabular-nums">{formatTokens(project.totalTokens)}</span>{' '}
                tokens
              </span>
            </>
          )}
        </div>
        <span className="truncate text-label text-[var(--label)]">
          最近活跃 {formatRelativeTime(project.lastSessionAt)}
        </span>
      </div>
    </button>
  );
};

export default ProjectCard;
