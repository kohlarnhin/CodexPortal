export interface SkillInfo {
  name: string;
  dirName: string;
  description: string;
  isSymlink: boolean;
  path: string;
}

export interface SkillDetail {
  name: string;
  dirName: string;
  description: string;
  isSymlink: boolean;
  path: string;
  fileCount: number;
  content: string;
}
