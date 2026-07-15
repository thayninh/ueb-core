export interface PipelineCliArguments {
  filePath: string;
  confirmSha?: string;
  sheetName?: string;
}

export function parsePipelineArguments(
  argumentsList: string[],
  options: { requireConfirmSha: boolean; allowSheet?: boolean },
): PipelineCliArguments {
  let filePath: string | undefined;
  let confirmSha: string | undefined;
  let sheetName: string | undefined;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;

    if (
      argument === "--file" ||
      argument === "--confirm-sha" ||
      argument === "--sheet"
    ) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new PipelineCliError(`Missing value for ${argument}.`);
      }
      if (argument === "--file") filePath = value;
      if (argument === "--confirm-sha") confirmSha = value;
      if (argument === "--sheet") sheetName = value;
      index += 1;
      continue;
    }

    throw new PipelineCliError(`Unknown argument: ${argument}`);
  }

  if (!filePath)
    throw new PipelineCliError("Missing required --file argument.");
  if (options.requireConfirmSha && !confirmSha) {
    throw new PipelineCliError("Missing required --confirm-sha argument.");
  }
  if (!options.requireConfirmSha && confirmSha) {
    throw new PipelineCliError("--confirm-sha is only valid for data:import.");
  }
  if (!options.allowSheet && sheetName) {
    throw new PipelineCliError("--sheet is only valid for data:dry-run.");
  }

  return { filePath, confirmSha, sheetName };
}

export class PipelineCliError extends Error {}
