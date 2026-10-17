import * as vscode from 'vscode';

/** Opens `path` with the cursor at 1-based `line:column`, clamped to the document. */
export async function openFile(path: string, line: number, column: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  const lineIndex = Math.min(Math.max(line - 1, 0), Math.max(document.lineCount - 1, 0));
  const lineLength = document.lineAt(lineIndex).range.end.character;
  const position = new vscode.Position(lineIndex, Math.min(Math.max(column - 1, 0), lineLength));
  const range = new vscode.Range(position, position);
  const editor = await vscode.window.showTextDocument(document, {
    selection: range,
    preserveFocus: false,
  });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
