import { ValidationError } from './types';

export class BoltError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'BoltError';
  }
}

export class ConnectionError extends BoltError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

export class DatabaseLockedError extends ConnectionError {
  constructor(message: string = 'Database is locked') {
    super(message);
    this.code = 'DATABASE_LOCKED';
  }
}

export class QueryError extends BoltError {
  public sql?: string;
  public params?: any[];
  constructor(message: string, sql?: string, params?: any[]) {
    super(message, 'QUERY_ERROR');
    this.name = 'QueryError';
    this.sql = sql;
    this.params = params;
  }
}

export class SyntaxError extends QueryError {
  constructor(message: string, sql?: string, params?: any[]) {
    super(message, sql, params);
    this.code = 'SYNTAX_ERROR';
  }
}

export class ConstraintError extends BoltError {
  constructor(message: string) {
    super(message, 'CONSTRAINT_ERROR');
    this.name = 'ConstraintError';
  }
}

export class UniqueViolationError extends ConstraintError {
  public column?: string;
  public value?: any;
  constructor(message: string, column?: string, value?: any) {
    super(message);
    this.code = 'UNIQUE_VIOLATION';
    this.column = column;
    this.value = value;
  }
}

export class ForeignKeyError extends ConstraintError {
  constructor(message: string) {
    super(message);
    this.code = 'FOREIGN_KEY_ERROR';
  }
}

export class CheckViolationError extends ConstraintError {
  constructor(message: string) {
    super(message);
    this.code = 'CHECK_VIOLATION';
  }
}

export class MigrationError extends BoltError {
  constructor(message: string) {
    super(message, 'MIGRATION_ERROR');
    this.name = 'MigrationError';
  }
}

export class IrreversibleMigrationError extends MigrationError {
  constructor(message: string = 'Migration cannot be reversed') {
    super(message);
    this.code = 'IRREVERSIBLE_MIGRATION';
  }
}

export class DriverError extends BoltError {
  constructor(message: string) {
    super(message, 'DRIVER_ERROR');
    this.name = 'DriverError';
  }
}

export class ValidationFailedError extends BoltError {
  public errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super('Validation failed', 'VALIDATION_ERROR');
    this.errors = errors;
  }
}