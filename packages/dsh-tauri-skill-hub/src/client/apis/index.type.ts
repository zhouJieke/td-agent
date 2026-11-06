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

export interface PostApiTauriSkillHubEmployeeSkillsUseruserIdBody {}
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
