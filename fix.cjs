const fs = require('fs');
const path = require('path');

// 1. Fix Backend DI (AuthorizationService should only be provided by ProfilesModule, which we make @Global)
const dir = path.join(process.cwd(), 'backend/src/modules');
function traverse(currentDir) {
  const files = fs.readdirSync(currentDir);
  for (const file of files) {
    const fullPath = path.join(currentDir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      traverse(fullPath);
    } else if (fullPath.endsWith('.module.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      if (file === 'profiles.module.ts') {
        if (!content.includes('@Global()')) {
          content = content.replace('import { Module }', 'import { Module, Global }');
          content = content.replace('@Module({', '@Global()\n@Module({');
          fs.writeFileSync(fullPath, content);
          console.log('Made ProfilesModule @Global()');
        }
      } else {
        if (content.includes('AuthorizationService')) {
          content = content.replace(/,\s*AuthorizationService/g, '');
          content = content.replace(/AuthorizationService,\s*/g, '');
          content = content.replace(/import\s+\{\s*AuthorizationService\s*\}\s*from\s*[\"'].*?authorization\.service[\"'];\r?\n?/g, '');
          fs.writeFileSync(fullPath, content);
          console.log('Removed AuthorizationService from providers in: ' + file);
        }
      }
    }
  }
}
traverse(dir);

// 2. Fix Database Routing (.env.local missing DB_PROVIDER=neon)
const envs = ['.env.local', 'backend/.env', 'backend/.env.local'];
for (const envFile of envs) {
  const envPath = path.join(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf8');
    if (!env.includes('DB_PROVIDER=')) {
      fs.appendFileSync(envPath, '\nDB_PROVIDER=neon\n');
      console.log('Added DB_PROVIDER=neon to ' + envFile);
    } else {
      env = env.replace(/DB_PROVIDER=.*/g, 'DB_PROVIDER=neon');
      fs.writeFileSync(envPath, env);
      console.log('Updated DB_PROVIDER to neon in ' + envFile);
    }
  }
}
