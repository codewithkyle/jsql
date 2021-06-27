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
export type CheckOperation = "=" | "==" | "!=" | "!==" | ">" | "<" | ">=" | "<=" | "!>=" | "!<=" | "!>" | "!<" | "LIKE" | "INCLUDES" | "EXCLUDES";

export type Check = {
    type: CheckOperation, 
    column: string;
    value: any;
};
export type Condition = {
    requireAll: boolean,
    checks: Array<Check|Array<Check>>,
};

export type Query = {
    uniqueOnly: boolean,
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
};

export type Settings = {
    schema: string,
    dbWorker: string,
    streamWorker: string,
};