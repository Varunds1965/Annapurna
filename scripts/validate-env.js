#!/usr/bin/env node
/**
 * Validates that all required environment variables are set.
 * Run: node scripts/validate-env.js
 */
require('dotenv').config();

const REQUIRED = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
];

const RECOMMENDED = [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'UPI_VPA',
];

const errors = [];
const warnings = [];

REQUIRED.forEach(key => {
  if (!process.env[key]) errors.push(`Missing REQUIRED: ${key}`);
});

RECOMMENDED.forEach(key => {
  if (!process.env[key]) warnings.push(`Missing RECOMMENDED: ${key}`);
});

// Validate JWT_SECRET strength
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  errors.push('JWT_SECRET must be at least 32 characters');
}

// Check for known bad defaults
if (process.env.DB_PASSWORD === 'Varun121@') {
  errors.push('DB_PASSWORD is set to the leaked default. CHANGE IT IMMEDIATELY.');
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.includes('change_in_production')) {
  errors.push('JWT_SECRET contains placeholder text. Generate a proper secret.');
}

console.log(`
┌────────────────────────────────────────┐`);
console.log('│  Thali Plan — Environment Validator     │');
console.log('└────────────────────────────────────────┘\n');

if (errors.length) {
  console.log('❌ ERRORS (app will not start):');
  errors.forEach(e => console.log(`   • ${e}`));
  console.log();
}

if (warnings.length) {
  console.log('⚠  WARNINGS (features will be limited):');
  warnings.forEach(w => console.log(`   • ${w}`));
  console.log();
}

if (!errors.length && !warnings.length) {
  console.log('✅ All environment variables are properly configured!\n');
}

if (errors.length) {
  console.log('Fix the above errors before starting the server.\n');
  process.exit(1);
}