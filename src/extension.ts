import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { Dirent } from "node:fs";

const getBaseCwd = () => {
  const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

  if (!cwd) {
    throw new Error("No VSCode workspace detected");
  }

  return cwd;
};

const exists = async (filePath: string) => {
  const result = await fs.access(filePath).catch((err) => err);

  if (result && result?.code !== "ENOENT") {
    console.log("ERROR RESULT: ", result);
    throw new Error("Unexpected error:", result);
  }

  return !result;
};

const hasNodeModules = async (dirPath: string) =>
  exists(`${dirPath}/node_modules`);

const getActiveFilePath = () =>
  vscode.window.activeTextEditor?.document.fileName;

const getSubDirectories = async (dirPath: string) => {
  const readdirResults = await fs.readdir(dirPath, { withFileTypes: true });

  return readdirResults.filter((entry) => entry.isDirectory());
};

const determineNodeModulesDir = async () => {
  const cwd = getBaseCwd();
  const hasTopLevelNodeModules = await hasNodeModules(cwd);

  if (hasTopLevelNodeModules) {
    return cwd;
  }

  const activeFile = getActiveFilePath();

  if (!activeFile) {
    throw new Error("Unable to located a node modules directory");
  }
  const relativePath = path.relative(cwd, activeFile);
  const subDir = relativePath.slice(0, relativePath.indexOf("/"));

  const subDirPath = path.join(cwd, subDir);

  if (!hasNodeModules(subDirPath)) {
    throw new Error("Only doing one level of recursion so far");
  }

  return subDirPath;
};

const getDirentType = (input: Dirent) => {
  if (input.isDirectory()) {
    return "dir";
  }

  if (input.isFile()) {
    return "file";
  }

  if (input.isSymbolicLink()) {
    return "symlink";
  }

  return "unknown";
};

const typeToEmoji = (inputType: ReturnType<typeof getDirentType>) =>
  ({
    dir: "📂",
    file: "📄",
    symlink: "🔗",
    unknown: "?",
  }[inputType]);

const direntToPickOption = (input: Dirent, parentName: string = "") => {
  const type = getDirentType(input);

  const packageName = !parentName
    ? input.name
    : [parentName, input.name].join("/");

  const name = `${typeToEmoji(type)} ${packageName}`;

  return {
    name,
    path: path.join(input.path, input.name),
    type,
  };
};

const getNodeModulesSubDirectories = async (nodeModulesDir: string) => {
  const subNodeModules = await getSubDirectories(nodeModulesDir);
  const subDirs = await Promise.all(
    subNodeModules.map(async (subDir) => {
      if (!subDir.isDirectory()) {
        return [];
      }

      const subDirPath = path.join(subDir.path, subDir.name);

      if (await exists(path.join(subDirPath, "package.json"))) {
        return [{ name: subDir.name, path: subDirPath, type: "dir" }];
      }

      const subSubDirs = await getSubDirectories(subDirPath);
      return subSubDirs.map((subSubDir) =>
        direntToPickOption(subSubDir, subDir.name)
      );
    })
  );

  return subDirs.flat();
};

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "node-modules-search.helloWorld",
    async () => {
      const nodeModulesDir = await determineNodeModulesDir();

      const topLevelNodeModules = path.join(nodeModulesDir, "node_modules");

      const installedPackages = await getNodeModulesSubDirectories(
        topLevelNodeModules
      );

      let fileSelected = false;
      let quickPickOptions = installedPackages;
      let currentLocation = topLevelNodeModules;

      while (!fileSelected) {
        const formattedOptions = quickPickOptions.map((pkg) => ({
          label: pkg.name,
          information: pkg,
        }));

        if (currentLocation !== topLevelNodeModules) {
          formattedOptions.unshift({
            label: "..",
            information: {
              type: "unknown",
              name: "back up",
              path: path.normalize(path.join(currentLocation, "..")),
            },
          });
        }

        const result = await vscode.window.showQuickPick(formattedOptions);

        if (!result) {
          return;
        }

        if (result.information.type === "file") {
          fileSelected = true;

          await vscode.window.showTextDocument(
            vscode.Uri.file(result.information.path)
          );
          await vscode.commands.executeCommand(
            "workbench.files.action.showActiveFileInExplorer"
          );

          return;
        }

        currentLocation = result.information.path;
        console.log("result.information.path: ", result.information.path);

        if (result.information.path.endsWith("node_modules")) {
          quickPickOptions = await getNodeModulesSubDirectories(
            result.information.path
          );
          continue;
        }

        const selectionContents = await fs.readdir(result.information.path, {
          withFileTypes: true,
        });

        quickPickOptions = selectionContents.map((item) =>
          direntToPickOption(item)
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
