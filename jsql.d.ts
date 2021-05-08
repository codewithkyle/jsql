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

export type Query = {
    type: "SELECT" | "UPDATE" | "DELETE" | "INSERT",
    table: string,
    columns: Array<string>,
    where: {
        [column:string]: any,
    },
    limit: number,
    offset: number,
    order: {
        column: string,
        by: "ASC" | "DESC",
    },
    values: Array<any>,
};