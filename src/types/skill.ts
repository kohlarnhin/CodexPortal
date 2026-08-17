export interface SkillInfo {
  name: string;
  description: string;
  isSymlink: boolean;
  path: string;
}

export interface SkillDetail {
  name: string;
  description: string;
  isSymlink: boolean;
  path: string;
  fileCount: number;
  content: string;
}
