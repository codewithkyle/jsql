export type Schema = {
    name: string,
	version: number,
	tables: Array<Table>,
};

export type Table = {
	name: string,
	columns: Array<Column>,
	keyPath?: string,
	autoIncrement?: boolean,
};

export type Column = {
	key: string,
	unique?: boolean,
};

export type SQLFunction = "COUNT" | "AVG" | "MIN" | "MAX" | "SUM";
export type SQLStatement = "SELECT" | "UPDATE" | "DELETE" | "INSERT" | "RESET";
export type CheckOperation = "=" | "==" | "!=" | "!==" | ">" | "<" | ">=" | "<=" | "!>=" | "!<=" | "!>" | "!<";

export type Check = {
    type: CheckOperation, 
    column: string;
    values: Array<any>;
};
export type Condition = {
    requireAll: boolean;
    requireOne: boolean;
    columns: Array<Check>;
    groups: Array<Condition>;
};

export type Query = {
    type: SQLStatement,
    function: SQLFunction,
    table: string,
    columns: Array<string>,
    where: Array<Condition>,
    limit: number,
    offset: number,
    order: {
        column: string,
        by: "ASC" | "DESC",
    },
    values: Array<any>,
    set: {
        [column:string]: any,
    },
    search: {
        [column:string]: any,
    }
};

export type Settings = {
    schema: string,
    dbWorker: string,
    streamWorker: string,
};