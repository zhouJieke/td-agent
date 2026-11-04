import { defineWebServer } from 'dsh-h3'
import { guard } from 'dsh-tauri'
import {
  commonSkillsGet,
  employeesGet,
  profileGet,
  skillUploadPost,
  skillsCatalogGet,
  userSkillsGet,
  userSkillsPost,
} from './routes/employee-skills'

export const server = defineWebServer((app) => {
  app.use(guard)
  app.get('/api/tauri/skill-hub/employee-skills/common', commonSkillsGet)
  app.get('/api/tauri/skill-hub/employee-skills', skillsCatalogGet)
  app.get('/api/tauri/skill-hub/employee-skills/user/:userId', userSkillsGet)
  app.get('/api/tauri/skill-hub/employee-skills/user/:userId/profile', profileGet)
  app.post('/api/tauri/skill-hub/employee-skills/user/:userId', userSkillsPost)
  app.get('/api/tauri/skill-hub/employee-skills/employees', employeesGet)
  app.post('/api/tauri/skill-hub/employee-skills/upload', skillUploadPost)
})
