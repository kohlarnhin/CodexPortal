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
      onClick={() => onOpen(project)}
      title={project.path}
      className="group min-w-0 text-left bg-card rounded-xl border shadow-xs hover:bg-accent/40 transition-colors p-4 flex flex-col cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-3 mb-3 min-w-0 w-full">
        <div className="w-8 h-8 shrink-0 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
          <Folder size={16} />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-subtitle font-medium text-foreground">{project.name}</h3>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-3 border-t mt-auto w-full">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-caption font-medium text-muted-foreground">
            会话 <span className="font-medium text-foreground tabular-nums">{project.sessionCount}</span>
          </span>
          {project.totalTokens > 0 && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-caption text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{formatTokens(project.totalTokens)}</span>{' '}
                tokens
              </span>
            </>
          )}
        </div>
        <span className="text-caption text-muted-foreground truncate">
          最近活跃 {formatRelativeTime(project.lastSessionAt)}
        </span>
      </div>
    </button>
  );
};

export default ProjectCard;
