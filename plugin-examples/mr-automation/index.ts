import type { DesktopPluginContext } from "@getpaseo/plugin/desktop";

export default function contribute(plugin: DesktopPluginContext) {
  plugin.addMRPredicate({
    id: "target-prefix",
    title: "Target branch starts with",
    description: "Matches a configurable target-branch prefix.",
    fields: [{ key: "prefix", type: "text", label: "Prefix", required: true }],
    evaluate: ({ config, mergeRequest }) =>
      mergeRequest.targetBranch.startsWith(String(config.prefix)) ? "match" : "no_match",
  });

  plugin.addMROperation({
    id: "project-link",
    title: "Open project link",
    description: "Builds a project-and-MR link under a configurable base URL.",
    kind: "link",
    allowedPresentations: ["link"],
    fields: [{ key: "baseUrl", type: "text", label: "Base URL", required: true }],
    run: ({ config, mergeRequest }) => {
      const baseUrl = String(config.baseUrl).replace(/\/+$/, "");
      return `${baseUrl}/${mergeRequest.projectId}/${mergeRequest.iid}`;
    },
  });

  return () => undefined;
}
