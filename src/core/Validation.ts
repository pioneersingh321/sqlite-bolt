import { ValidationRule } from '../types';

export const rule = {
  required: (msg?: string): ValidationRule => ({
    name: 'required',
    message: msg,
    test: (v: any) => v !== undefined && v !== null && v !== ''
  }),
  minLength: (n: number, msg?: string): ValidationRule => ({
    name: 'minLength',
    message: msg,
    test: (v: any) => String(v).length >= n
  }),
  maxLength: (n: number, msg?: string): ValidationRule => ({
    name: 'maxLength',
    message: msg,
    test: (v: any) => String(v).length <= n
  }),
  email: (msg?: string): ValidationRule => ({
    name: 'email',
    message: msg,
    test: (v: any) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))
  }),
  unique: (table: string, column: string, msg?: string): ValidationRule => ({
    name: 'unique',
    message: msg,
    test: async (v: any, db?: any) => {
      if (!db) return true;
      const row = await db.query(`SELECT 1 FROM "${table}" WHERE "${column}" = ? LIMIT 1`, [v]);
      return row.length === 0;
    }
  }),
  inArray: (arr: any[], msg?: string): ValidationRule => ({
    name: 'inArray',
    message: msg,
    test: (v: any) => arr.includes(v)
  }),
  numeric: (msg?: string): ValidationRule => ({
    name: 'numeric',
    message: msg,
    test: (v: any) => !isNaN(Number(v))
  }),
  integer: (msg?: string): ValidationRule => ({
    name: 'integer',
    message: msg,
    test: (v: any) => Number.isInteger(Number(v))
  }),
  regex: (pattern: RegExp, msg?: string): ValidationRule => ({
    name: 'regex',
    message: msg,
    test: (v: any) => pattern.test(String(v))
  }),
  date: (msg?: string): ValidationRule => ({
    name: 'date',
    message: msg,
    test: (v: any) => !isNaN(Date.parse(String(v)))
  })
};