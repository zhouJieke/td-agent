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
