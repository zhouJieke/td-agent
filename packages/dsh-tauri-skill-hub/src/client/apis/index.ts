/*
 * @title index
 * @swagger 2.0
 * @version 0.0.0
 */

import type * as Types from "./index.type";
import { ofetch } from "dsh-tauri/client";
import type { FetchOptions } from "dsh-tauri/client";

/** @method get */
export function getEmployeeSkillsCommon(params?: Types.GetApiTauriSkillHubEmployeeSkillsCommonQuery, options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubEmployeeSkillsCommonResponse>("/api/tauri/skill-hub/employee-skills/common", { method: "get", params, ...options });
}

/** @method get */
export function getEmployeeSkills(params?: Types.GetApiTauriSkillHubEmployeeSkillsQuery, options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubEmployeeSkillsResponse>("/api/tauri/skill-hub/employee-skills", { method: "get", params, ...options });
}

/** @method get */
export function getEmployeeSkillsUserUserId(paths: Types.GetApiTauriSkillHubEmployeeSkillsUseruserIdPath, options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubEmployeeSkillsUseruserIdResponse>(`/api/tauri/skill-hub/employee-skills/user/${paths.userId}`, { method: "get", ...options });
}

/** @method post */
export function postEmployeeSkillsUserUserId(paths: Types.PostApiTauriSkillHubEmployeeSkillsUseruserIdPath, body: Types.PostApiTauriSkillHubEmployeeSkillsUseruserIdBody, options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubEmployeeSkillsUseruserIdResponse>(`/api/tauri/skill-hub/employee-skills/user/${paths.userId}`, { method: "post", body, ...options });
}

/** @method get */
export function getEmployeeSkillsUserUserIdProfile(paths: Types.GetApiTauriSkillHubEmployeeSkillsUseruserIdProfilePath, options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubEmployeeSkillsUseruserIdProfileResponse>(`/api/tauri/skill-hub/employee-skills/user/${paths.userId}/profile`, { method: "get", ...options });
}

/** @method get */
export function getEmployeeSkillsEmployees(options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubEmployeeSkillsEmployeesResponse>("/api/tauri/skill-hub/employee-skills/employees", { method: "get", ...options });
}

/** @method post */
export function postEmployeeSkillsUpload(options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubEmployeeSkillsUploadResponse>("/api/tauri/skill-hub/employee-skills/upload", { method: "post", ...options });
}

/** @method get */
export function getLocalSkill(params?: Types.GetApiTauriSkillHubLocalSkillQuery, options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubLocalSkillResponse>("/api/tauri/skill-hub/local-skill", { method: "get", params, ...options });
}

/** @method get */
export function getInstalledSkills(options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubInstalledSkillsResponse>("/api/tauri/skill-hub/installed-skills", { method: "get", ...options });
}

/** @method get */
export function getSkills(options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubSkillsResponse>("/api/tauri/skill-hub/skills", { method: "get", ...options });
}

/** @method post */
export function postSkillsRefresh(options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubSkillsRefreshResponse>("/api/tauri/skill-hub/skills/refresh", { method: "post", ...options });
}

/** @method get */
export function getSkill(params?: Types.GetApiTauriSkillHubSkillQuery, options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubSkillResponse>("/api/tauri/skill-hub/skill", { method: "get", params, ...options });
}

/** @method post */
export function postSkill(body: Types.PostApiTauriSkillHubSkillBody, options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubSkillResponse>("/api/tauri/skill-hub/skill", { method: "post", body, ...options });
}

/** @method delete */
export function deleteSkill(body: Types.DeleteApiTauriSkillHubSkillBody, options?: FetchOptions) {
  return ofetch<Types.DeleteApiTauriSkillHubSkillResponse>("/api/tauri/skill-hub/skill", { method: "delete", body, ...options });
}

/** @method post */
export function postSkillPolicy(body: Types.PostApiTauriSkillHubSkillPolicyBody, options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubSkillPolicyResponse>("/api/tauri/skill-hub/skill/policy", { method: "post", body, ...options });
}

/** @method post */
export function postOpenDir(body: Types.PostApiTauriSkillHubOpenDirBody, options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubOpenDirResponse>("/api/tauri/skill-hub/open/dir", { method: "post", body, ...options });
}

/** @method get */
export function getRoots(options?: FetchOptions) {
  return ofetch<Types.GetApiTauriSkillHubRootsResponse>("/api/tauri/skill-hub/roots", { method: "get", ...options });
}

/** @method post */
export function postRoots(body: Types.PostApiTauriSkillHubRootsBody, options?: FetchOptions) {
  return ofetch<Types.PostApiTauriSkillHubRootsResponse>("/api/tauri/skill-hub/roots", { method: "post", body, ...options });
}

/** @method delete */
export function deleteRoots(body: Types.DeleteApiTauriSkillHubRootsBody, options?: FetchOptions) {
  return ofetch<Types.DeleteApiTauriSkillHubRootsResponse>("/api/tauri/skill-hub/roots", { method: "delete", body, ...options });
}
