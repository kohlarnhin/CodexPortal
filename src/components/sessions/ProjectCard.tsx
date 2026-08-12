import React from 'react';
import { SessionProject } from '../../types/session';
import { formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';

interface ProjectCardProps {
  project: SessionProject;
  onOpen: (project: SessionProject) => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen }) => {
  return (
    <button
      onClick={() => onOpen(project)}
      title={project.path}
      className="group text-left bg-white rounded-xl border border-[#EAEAEA] hover:border-[#C8C8C8] hover:shadow-sm transition-all p-5 flex flex-col cursor-pointer"
    >
      <div className="flex items-center gap-3 mb-3 min-w-0">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-[#F5F5F5] border border-[#EAEAEA] flex items-center justify-center text-[#777777] group-hover:bg-black group-hover:text-white group-hover:border-black transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-black tracking-tight">{project.name}</h3>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#EAEAEA] mt-auto">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-medium text-[#555555]">
            会话 <span className="font-bold text-black">{project.sessionCount}</span>
          </span>
          {project.totalTokens > 0 && (
            <>
              <span className="text-[#D0D0D0]">·</span>
              <span className="text-[11px] text-[#555555]">
                <span className="font-bold text-black">{formatTokens(project.totalTokens)}</span>{' '}
                tokens
              </span>
            </>
          )}
        </div>
        <span className="text-[11px] text-[#999999] truncate">
          最近活跃 {formatRelativeTime(project.lastSessionAt)}
        </span>
      </div>
    </button>
  );
};

export default ProjectCard;
