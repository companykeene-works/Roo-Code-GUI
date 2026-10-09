import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

const gitRootCache = new Map<string, string | null>()

export function findGitRoot(startDir: string): string | null {
	const resolved = path.resolve(startDir)
	if (gitRootCache.has(resolved)) {
		return gitRootCache.get(resolved)!
	}

	let current = resolved
	while (true) {
		const gitPath = path.join(current, ".git")
		try {
			if (fs.existsSync(gitPath)) {
				gitRootCache.set(resolved, current)
				return current
			}
		} catch (_) {}

		const parent = path.dirname(current)
		if (parent === current) {
			break
		}
		current = parent
	}

	gitRootCache.set(resolved, null)
	return null
}

/**
 * Checks if a file path is outside all workspace folders
 * @param filePath The file path to check
 * @returns true if the path is outside all workspace folders, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string, customWorkspacePath?: string): boolean {
	if (!filePath || !filePath.trim()) {
		return false
	}

	const baseDir =
		customWorkspacePath && customWorkspacePath.trim()
			? customWorkspacePath.trim()
			: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()

	const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(baseDir, filePath)
	const normAbsolute =
		process.platform === "win32" ? path.normalize(absolutePath).toLowerCase() : path.normalize(absolutePath)

	const isInside = (dir: string) => {
		const normDir = process.platform === "win32" ? path.normalize(dir).toLowerCase() : path.normalize(dir)
		if (normAbsolute === normDir || normAbsolute.startsWith(normDir + (normDir.endsWith(path.sep) ? "" : path.sep))) {
			return true
		}
		const repoRoot = findGitRoot(normDir)
		if (repoRoot) {
			const normRepo =
				process.platform === "win32" ? path.normalize(repoRoot).toLowerCase() : path.normalize(repoRoot)
			if (normAbsolute === normRepo || normAbsolute.startsWith(normRepo + (normRepo.endsWith(path.sep) ? "" : path.sep))) {
				return true
			}
		}
		return false
	}

	if (customWorkspacePath && customWorkspacePath.trim()) {
		if (isInside(path.resolve(customWorkspacePath))) {
			return false
		}
	}

	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		const foundInWorkspace = vscode.workspace.workspaceFolders.some((folder) => isInside(folder.uri.fsPath))
		if (foundInWorkspace) {
			return false
		}
	}

	return Boolean(customWorkspacePath?.trim() || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0))
}
