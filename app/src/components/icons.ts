import { Flag, Filter, FolderInput, FolderSearch, GitBranch, Play, Box, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = { start: Play, list_files: FolderSearch, filter: Filter, condition: GitBranch, move_file: FolderInput, finish: Flag };
export const nodeIcon = (type: string): LucideIcon => ICONS[type] ?? Box;
