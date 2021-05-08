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
};

export type Column = {
	key: string;
	unique?: boolean;
};