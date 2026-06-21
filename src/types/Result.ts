export interface ExecuteResult {
  changes: number;
  lastId?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    lastPage: number;
  };
}

export interface ValidationError {
  field: string;
  rule: string;
  message: string;
}

export interface ValidationRule {
  name: string;
  message?: string;
  test: (value: any, db?: Queryable) => boolean | Promise<boolean>;
}

export type ValidationRuleSet<T> = Partial<Record<keyof T | string, ValidationRule[]>>;

export interface WhereClause {
  type: 'and' | 'or';
  field: string;
  operator: string;
  value?: any;
  raw?: boolean;
  rawBindings?: any[];
  subquery?: string;
  subqueryParams?: any[];
}

export interface JoinClause {
  table: string;
  on: string;
  type: string;
}

export interface QueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

export interface Queryable {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<ExecuteResult>;
}
