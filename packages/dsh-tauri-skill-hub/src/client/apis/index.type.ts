export type GetApiTauriSkillHubEmployeeSkillsCommonResponse = unknown;
export type GetApiTauriSkillHubEmployeeSkillsCommonQueryPageNo = undefined | string;
export type GetApiTauriSkillHubEmployeeSkillsCommonQueryPageSize = undefined | string;
export type GetApiTauriSkillHubEmployeeSkillsResponse = unknown;
export type GetApiTauriSkillHubEmployeeSkillsQueryPageNo = undefined | string;
export type GetApiTauriSkillHubEmployeeSkillsQueryPageSize = undefined | string;
export type GetApiTauriSkillHubEmployeeSkillsUseruserIdResponse = unknown;
export type GetApiTauriSkillHubEmployeeSkillsUseruserIdProfileResponse = unknown;
export type PostApiTauriSkillHubEmployeeSkillsUseruserIdResponse = unknown;
export type GetApiTauriSkillHubEmployeeSkillsEmployeesResponse = unknown;
export type PostApiTauriSkillHubEmployeeSkillsUploadResponse = unknown;
export type GetApiTauriSkillHubLocalSkillResponse = { status: "ready" | "pending" | "shadowed" | "not-invocable" | "unavailable" } | { error: string };
export type GetApiTauriSkillHubLocalSkillQueryName = undefined | string;
export type GetApiTauriSkillHubInstalledSkillsResponse = { names: string[] } | { error: string };
export type GetApiTauriSkillHubSkillsResponse = { skills: ({ name: string; description: string; whenToUse?: undefined | string; invocation: { modelInvocable: false | true; userInvocable: false | true }; source: string; provider: string; resourceBase?: undefined | { kind: "directory"; path: string } | { kind: "url"; url: string } | { kind: "opaque"; description: string } } & { editable: false | true; removable: false | true; dir?: undefined | string; policyEditable: false | true; repository?: undefined | { id: string; label: string; kind: "local" | "git"; githubUrl?: undefined | string } })[] } | { error: string };
export type PostApiTauriSkillHubSkillsRefreshResponse = { skills: ({ name: string; description: string; whenToUse?: undefined | string; invocation: { modelInvocable: false | true; userInvocable: false | true }; source: string; provider: string; resourceBase?: undefined | { kind: "directory"; path: string } | { kind: "url"; url: string } | { kind: "opaque"; description: string } } & { editable: false | true; removable: false | true; dir?: undefined | string; policyEditable: false | true; repository?: undefined | { id: string; label: string; kind: "local" | "git"; githubUrl?: undefined | string } })[] } | { error: string };
export type GetApiTauriSkillHubSkillResponse = { name: string; content: string } | { error: string };
export type GetApiTauriSkillHubSkillQueryName = undefined | string;
export type PostApiTauriSkillHubSkillResponse = { ok: false | true; name?: undefined | string } | { error: string };
export type DeleteApiTauriSkillHubSkillResponse = { ok: false | true; name?: undefined | string } | { error: string };
export type PostApiTauriSkillHubSkillPolicyResponse = { ok: false | true; name?: undefined | string } | { error: string };
export type PostApiTauriSkillHubOpenDirResponse = { ok: false | true; name?: undefined | string } | { error: string };
export type GetApiTauriSkillHubRootsResponse = { roots: ({ id: string; kind: "local" | "git"; label: string; url?: undefined | string; ref?: undefined | string; path?: undefined | string; roots: string[]; materialDir?: undefined | string; addedAt: number } & { live: false | true })[] } | { error: string };
export type PostApiTauriSkillHubRootsResponse = { ok: false | true; root: { id: string; kind: "local" | "git"; label: string; url?: undefined | string; ref?: undefined | string; path?: undefined | string; roots: string[]; materialDir?: undefined | string; addedAt: number } & { live: false | true } } | { error: string };
export type DeleteApiTauriSkillHubRootsResponse = { ok: false | true; name?: undefined | string } | { error: string };

export interface PostApiTauriSkillHubEmployeeSkillsUseruserIdBody {}
export interface PostApiTauriSkillHubSkillBody {
  name: string;
  description: string;
  whenToUse?: undefined | string;
  modelInvocable?: undefined | false | true;
  userInvocable?: undefined | false | true;
  content: string;
}
export interface DeleteApiTauriSkillHubSkillBody {
  name: string;
}
export interface PostApiTauriSkillHubSkillPolicyBody {
  name: string;
  enabled: false | true;
}
export interface PostApiTauriSkillHubOpenDirBody {
  target: "user-skills" | "skill";
  name?: undefined | string;
}
export interface PostApiTauriSkillHubRootsBody {
  kind: "local" | "git";
  path?: undefined | string;
  url?: undefined | string;
}
export interface DeleteApiTauriSkillHubRootsBody {
  id: string;
}
export interface GetApiTauriSkillHubEmployeeSkillsCommonQuery {
  pageNo?: GetApiTauriSkillHubEmployeeSkillsCommonQueryPageNo;
  pageSize?: GetApiTauriSkillHubEmployeeSkillsCommonQueryPageSize;
}
export interface GetApiTauriSkillHubEmployeeSkillsQuery {
  pageNo?: GetApiTauriSkillHubEmployeeSkillsQueryPageNo;
  pageSize?: GetApiTauriSkillHubEmployeeSkillsQueryPageSize;
}
export interface GetApiTauriSkillHubEmployeeSkillsUseruserIdPath {
  userId: string;
}
export interface PostApiTauriSkillHubEmployeeSkillsUseruserIdPath {
  userId: string;
}
export interface GetApiTauriSkillHubEmployeeSkillsUseruserIdProfilePath {
  userId: string;
}
export interface GetApiTauriSkillHubLocalSkillQuery {
  name?: GetApiTauriSkillHubLocalSkillQueryName;
}
export interface GetApiTauriSkillHubSkillQuery {
  name?: GetApiTauriSkillHubSkillQueryName;
}
