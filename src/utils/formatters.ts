export const formatLinkMethod = (method: string): string => {
  switch (method) {
    case "NpmPack": return "npm pack";
    case "Symlink": return "symlink";
    case "Yalc": return "yalc";
    case "Workspace": return "workspace";
    default: return method.toLowerCase();
  }
};

/**
 * Renders a PackageManager enum value using each tool's standard notation
 * (lowercase, matching how they appear in package.json's `packageManager`
 * field and on the command line). "Unknown" stays a readable status label.
 */
export const formatPackageManager = (pm: string): string => {
  switch (pm) {
    case "Npm": return "npm";
    case "Yarn": return "yarn";
    case "Pnpm": return "pnpm";
    case "Bun": return "bun";
    case "Unknown": return "Unknown";
    default: return pm.toLowerCase();
  }
};

/**
 * Formats a byte size into a human-readable string.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
