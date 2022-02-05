export interface StreamArgs {
    method?: string;
    headers?: {
        [header: string]: string;
    };
    credentials?: "include" | "omit" | "same-origin";
}

export type Schema = {
    name: string;
    version: number;
    tables: Array<Table>;
};

export type Table = {
    name: string;
    columns: Array<Column>;
    keyPath?: string;
    autoIncrement?: boolean;
    persist?: boolean;
};

export type Column = {
    key: string;
    unique?: boolean;
    default?: any;
};

export type SQLFunction = "COUNT" | "AVG" | "MIN" | "MAX" | "SUM";
export type SQLStatement = "SELECT" | "UPDATE" | "DELETE" | "INSERT" | "RESET";
export type CheckOperation = "=" | "==" | "!=" | "!==" | ">" | "<" | ">=" | "<=" | "!>=" | "!<=" | "!>" | "!<" | "LIKE" | "INCLUDES" | "EXCLUDES" | "IN" | "!IN";

export type Check = {
    type: CheckOperation;
    column: string;
    value: any;
    format: Format | null;
};
export type Condition = {
    requireAll: boolean;
    checks: Array<Check | Array<Check>>;
};

export type FormatType = "DATE" | "JSON" | "INT" | "BOOL" | "FLOAT";
export type Format = {
    type: FormatType;
    args?: any;
};

export type Query = {
    uniqueOnly: boolean;
    type: SQLStatement;
    functions: Array<{
        column: string;
        key: string;
        function: SQLFunction;
    }>;
    table: string;
    columns: Array<string>;
    where: Array<Condition>;
    limit: number;
    offset: number;
    order: {
        column: string;
        by: "ASC" | "DESC";
    };
    group: string;
    values: Array<any>;
    set: {
        [column: string]: any;
    };
    columnFormats: {
        [column: string]: Format;
    };
};

export type Settings = {
    schema: string;
    dbWorker: string;
    streamWorker: string;
};

export class Database {
    public start(settings?: Partial<Settings>): Promise<string | void>;

    /**
     * Access IndexedDB data using an SQL query.
     * @see https://jsql.codewithkyle.com/
     * @example await db.query("SELECT * FROM table_name WHERE column_name = $value", { value: 1 });
     */
    public query<T>(
        SQL: string,
        params?: {
            [key: string]: any;
        } | null,
        debug?: boolean
    ): Promise<Array<T>>;

    public ingest(url: string, table: string, type?: "JSON" | "NDJSON"): Promise<void>;
}
declare const db: Database;
export default db;
