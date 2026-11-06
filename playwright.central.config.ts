import {defineConfig,devices} from '@playwright/test'
export default defineConfig({testDir:'./tests/e2e',testMatch:'central-ai.spec.ts',timeout:90000,workers:1,retries:0,reporter:[['list']],use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900},locale:'en-US',reducedMotion:'reduce',actionTimeout:10000,serviceWorkers:'block',trace:'retain-on-failure'},projects:[{name:'chromium'}]})
