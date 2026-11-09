import { defineWebServer } from 'dsh-h3'
import { guard } from 'dsh-tauri'
import {
  commonSkillsGet,
  employeesGet,
  profileGet,
  skillsCatalogGet,
  skillUploadPost,
  userSkillsGet,
  userSkillsPost,
} from './routes/employee-skills'
import installedSkills from './routes/installed-skills/get'
import localSkill from './routes/local-skill/get'
import openDir from './routes/open/dir/post'
import rootsRemove from './routes/roots/delete'
import roots from './routes/roots/get'
import rootsAdd from './routes/roots/post'
import skillDelete from './routes/skill/delete'
import skill from './routes/skill/get'
import skillPolicy from './routes/skill/policy/post'
import skillSave from './routes/skill/post'
import skills from './routes/skills/get'
import skillsRefresh from './routes/skills/refresh/post'

export const server = defineWebServer((app) => {
  app.use(guard)
  app.get('/api/tauri/skill-hub/employee-skills/common', commonSkillsGet)
  app.get('/api/tauri/skill-hub/employee-skills', skillsCatalogGet)
  app.get('/api/tauri/skill-hub/employee-skills/user/:userId', userSkillsGet)
  app.get('/api/tauri/skill-hub/employee-skills/user/:userId/profile', profileGet)
  app.post('/api/tauri/skill-hub/employee-skills/user/:userId', userSkillsPost)
  app.get('/api/tauri/skill-hub/employee-skills/employees', employeesGet)
  app.post('/api/tauri/skill-hub/employee-skills/upload', skillUploadPost)
  app.get('/api/tauri/skill-hub/local-skill', localSkill)
  app.get('/api/tauri/skill-hub/installed-skills', installedSkills)
  app.get('/api/tauri/skill-hub/skills', skills)
  app.post('/api/tauri/skill-hub/skills/refresh', skillsRefresh)
  app.get('/api/tauri/skill-hub/skill', skill)
  app.post('/api/tauri/skill-hub/skill', skillSave)
  app.delete('/api/tauri/skill-hub/skill', skillDelete)
  app.post('/api/tauri/skill-hub/skill/policy', skillPolicy)
  app.post('/api/tauri/skill-hub/open/dir', openDir)
  app.get('/api/tauri/skill-hub/roots', roots)
  app.post('/api/tauri/skill-hub/roots', rootsAdd)
  app.delete('/api/tauri/skill-hub/roots', rootsRemove)
})
