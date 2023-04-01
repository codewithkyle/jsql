import type { Params, Query, QueryParserResult, SQLFunction, FormatType, Check, Condition, Format, CheckOperation } from "../jsql";
import { CONDITIONS, uuid } from "./util";
import dayjs from "dayjs";

export default class SqlQueryParser {
    private query: string;
    private params: Params;

    constructor(query:string, params: Params){
        this.query = query.replace(/\-\-.*|\;$/g, "").trim();
        this.params = params;
    }

    public parse(): QueryParserResult {
        try{
            this.washStatement();
            const queries: Array<Query> = [];
            const statements = this.query.split(/\bUNION\b/i);
            for (let i = 0; i < statements.length; i++) {
                const query = this.buildQuery(statements[i]);
                this.injectValues(query);
                queries.push(query);
            }
            return {
                success: true,
                queries: queries,
                error: "",
            };
        } catch (e){
            let error = e;
            if (typeof e !== "string"){
                error = "Invalid syntax.";
            }
            return {
                success: false,
                queries: [],
                error: error,
            }
        }
    }

    private checkForUnsupportedOperators(segment:string):void{
        if (segment.indexOf("+") !== -1 || segment.indexOf("/") !== -1 || segment.indexOf("%") !== -1) {
            throw `Invalid syntax. Arithmetic operators are not currently supported.`;
        } else if (segment.indexOf("&") !== -1 || segment.indexOf("|") !== -1 || segment.indexOf("^") !== -1) {
            throw `Invalid syntax. Bitwise operators are not currently supported.`;
        }
    }

    private buildQuery(statement:string):Query{
        const segments: Array<Array<string>> = this.parseSegments(statement);
        let query: Query = {
            uniqueOnly: false,
            // @ts-ignore
            type: null,
            functions: [],
            // @ts-ignore
            table: null,
            columns: [],
            offset: 0,
            // @ts-ignore
            limit: null,
            // @ts-ignore
            where: null,
            // @ts-ignore
            values: null,
            // @ts-ignore
            order: null,
            // @ts-ignore
            set: null,
            // @ts-ignore
            group: null,
            // @ts-ignore
            columnFormats: null,
            columnAlias: [],
        };
        for (let i = segments.length - 1; i >= 0; i--) {
            this.checkForUnsupportedOperators(segments[i].join(" "));
            switch (segments[i][0].toUpperCase()) {
                case "SET":
                    this.parseSetSegment(segments[i], query);
                    break;
                case "VALUES":
                    this.parseValues(segments[i], query);
                    break;
                case "OFFSET":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.offset = segments[i][1].trim()[0] === "$" ? this.inject(segments[i][1]) : parseInt(segments[i][1]);
                    break;
                case "LIMIT":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.limit = segments[i][1].trim()[0] === "$" ? this.inject(segments[i][1]) : parseInt(segments[i][1]);
                    break;
                case "GROUP":
                    this.parseGroupBySegment(segments[i], query);
                    break;
                case "ORDER":
                    this.parseOrderBySegment(segments[i], query);
                    break;
                case "WHERE":
                    this.parseWhereSegment(segments[i], query);
                    break;
                case "FROM":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.table = segments[i][1];
                    break;
                case "SELECT":
                    query.type = "SELECT";
                    this.parseSelectSegment(segments[i], query);
                    break;
                case "DELETE":
                    query.type = "DELETE";
                    break;
                case "INSERT":
                    query.type = "INSERT";
                    this.parseInsertSegment(segments[i], query);
                    break;
                case "UPDATE":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.table = segments[i][1];
                    query.type = "UPDATE";
                    break;
                case "RESET":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.table = segments[i][1];
                    query.type = "RESET";
                    break;
                default:
                    throw `Invalid syntax at: ${segments[i].join(" ")}`;
            }
        }
        if (query.type === null) {
            throw `Invalid syntax: Missing SELECT, UPDATE, INSERT INTO, or DELETE statement.`;
        } else if (query.table === null) {
            throw `Invalid syntax: Missing FROM.`;
        } else if (query.type === "SELECT" && !query.columns?.length && !query.functions?.length) {
            throw `Invalid syntax: Missing columns.`;
        } else if (query.type === "INSERT" && query.values === null) {
            throw `Invalid syntax: Missing VALUES.`;
        } else if (query.type === "UPDATE" && query.set === null) {
            throw `Invalid syntax: Missing SET.`;
        } else if (query.type === "UPDATE" && query.where === null) {
            throw `Invalid syntax: Missing WHERE.`;
        } else if (query.limit !== null && isNaN(query.limit)) {
            throw `Invalid syntax: LIMIT is not a number.`;
        } else if (query.offset !== null && isNaN(query.offset)) {
            throw `Invalid syntax: OFFSET is not a number.`;
        }
        return query;
    }

    private parseSegments(statement:string) {
        let textNodes: Array<string> = statement.trim().split(/\s+/);
        const segments:Array<string[]> = [];
        while (textNodes.length > 0) {
            let index = -1;
            for (let i = textNodes.length - 1; i >= 0; i--) {
                switch (textNodes[i].toUpperCase()) {
                    case "HAVING":
                        throw `Invalid syntax: HAVING clause is not currently supported.`;
                    case "UNION":
                        throw `Invalid syntax: UNION operator is not currently supported.`;
                    case "JOIN":
                        throw `Invalid syntax: JOIN clause is not currently supported.`;
                    case "SET":
                        index = i;
                        break;
                    case "VALUES":
                        index = i;
                        break;
                    case "OFFSET":
                        index = i;
                        break;
                    case "LIMIT":
                        index = i;
                        break;
                    case "ORDER":
                        index = i;
                        break;
                    case "WHERE":
                        index = i;
                        break;
                    case "FROM":
                        index = i;
                        break;
                    case "SELECT":
                        index = i;
                        break;
                    case "DELETE":
                        index = i;
                        break;
                    case "INSERT":
                        index = i;
                        break;
                    case "UPDATE":
                        index = i;
                        break;
                    case "RESET":
                        index = i;
                        break;
                    case "GROUP":
                        index = i;
                        break;
                    default:
                        break;
                }
                if (index !== -1) {
                    break;
                }
            }
            if (index === -1 && textNodes.length > 0) {
                throw `Invalid syntax: ${statement}`;
            } else {
                segments.push(textNodes.splice(index, textNodes.length));
            }
        }
        return segments;
    }

    private parseSelectSegment(segments: Array<string>, query: Query): void {
        const wildcardIndex = segments.indexOf("*");
        if (wildcardIndex !== -1) {
            query.columns = ["*"];
            return;
        }

        // Removes SELECT string
        segments.shift();

        // Check for unqiue only
        if (segments[0].toUpperCase() === "DISTINCT" || segments[0].toUpperCase() === "UNIQUE") {
            if (segments.includes("*")) {
                throw `Invalid SELECT statement. DISTINCT or UNIQUE does not currently support the wildcard (*) character.`;
            }
            query.uniqueOnly = true;
            segments.splice(0, 1);
        }

        if (segments.length === 0) {
            throw `Invalid SELECT statement syntax.`;
        }

        // Clean segments
        segments = segments
                    .join(" ")
                    .replace(/(?<=\~.*?)\s+(?=.*?\~)/g, "")
                    .trim()
                    .split(",");

        let containsNonaggregatedData = false;
        let containsAggregatedData = false;
        for (let i = 0; i < segments.length; i++) {
            let seg = segments[i].trim();
            let alias:string|null = null;
            if (seg.search(/\bAS\b/i) !== -1) {
                alias = seg
                    .match(/\bAS.*\b/i)?.[0]
                    ?.replace(/\bAS\b/i, "")
                    ?.trim() || null;
                seg = seg.replace(/\bAS.*\b/i, "").trim();
            }
            if (seg.length) {
                if (
                    seg.search(/\bCOUNT\b/i) === 0 ||
                    seg.search(/\bMIN\b/i) === 0 ||
                    seg.search(/\bMAX\b/i) === 0 ||
                    seg.search(/\bAVG\b/i) === 0 ||
                    seg.search(/\bSUM\b/i) === 0
                ) {
                    containsNonaggregatedData = true;
                    const type = seg.match(/\w+/)?.[0]?.trim()?.toUpperCase() as SQLFunction;
                    const column = seg
                        .match(/\(.*?\)/)?.[0]
                        ?.replace(/\(|\)/g, "")
                        ?.trim() ?? "";
                    if (column === "*" && type !== "COUNT") {
                        throw `Invalid SELECT statement. Only the COUNT function be used with the wildcard (*) character.`;
                    }
                    query.functions?.push({
                        column: seg,
                        key: column,
                        function: type,
                    });
                    if (alias !== null) {
                        query.columnAlias?.push({
                            column: seg,
                            alias: alias,
                        });
                    }
                } else {
                    containsAggregatedData = true;
                    if (
                        seg.toUpperCase().search(/\bDATE\b/i) === 0 ||
                        seg.toUpperCase().search(/\bJSON\b/i) === 0 ||
                        seg.toUpperCase().search(/\bINT\b/i) === 0 ||
                        seg.toUpperCase().search(/\bBOOL\b/i) === 0 ||
                        seg.toUpperCase().search(/\bFLOAT\b/i) === 0
                    ) {
                        const type = seg.match(/\w+/)?.[0]?.trim()?.toUpperCase() as FormatType;
                        let column = seg
                            .match(/\~.*?(\~|\>)/)?.[0]
                            ?.replace(/\~|\>/g, "")
                            ?.trim() ?? "";
                        let args:string|null = null;
                        if (type === "DATE") {
                            args =
                                seg
                                    .match(/\>.*?\~/)?.[0]
                                    ?.replace(/\~|\+|\>|\'|\"/g, "")
                                    ?.trim() || null;
                            if (args === null) {
                                throw `Invalid DATE function syntax. You must provide a format string.`;
                            }
                        }
                        if (query.columnFormats === null) {
                            query.columnFormats = {};
                        }
                        query.columns?.push(column);
                        query.columnFormats[column] = {
                            type: type,
                            args: args,
                        };
                        if (alias !== null) {
                            query.columnAlias?.push({
                                column: column,
                                alias: alias,
                            });
                        }
                    } else {
                        query.columns?.push(seg);
                        if (alias !== null) {
                            query.columnAlias?.push({
                                column: seg,
                                alias: alias,
                            });
                        }
                    }
                }
            }
        }
        if (containsAggregatedData && containsNonaggregatedData) {
            throw `Invalid SELECT syntax. SELECT list contains both aggergated and nonaggergated data.`;
        }
    }

    private parseInsertSegment(segments: Array<string>, query: Query){
        if (segments.length < 3 || segments[1] !== "INTO") {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else if (segments.length === 3) {
            query.table = segments[2];
        } else {
            throw `Invalid syntax. Only 'INSERT INTO table_name' queries are currently supported.`;
        }
    }

    private parseValues(segments: Array<string>, query: Query) {
        if (segments.length === 1) {
            throw `Invalid syntax at: ${segments}.`;
        } else {
            query.values = [];
            segments.splice(0, 1);
            const objects = segments.join("").match(/(?<=\().*?(?=\))/g) || [];
            for (let i = 0; i < objects.length; i++) {
                const values = objects[i].split(",");
                for (let v = 0; v < values.length; v++){
                    query.values.push(values[v]);
                }
            }
        }
    }

    private parseSetSegment(segments: Array<string>, query: Query) {
        const columns = {};
        if (segments.length < 2) {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else {
            query.set = {};
            segments.splice(0, 1);
            const groups = segments.join(" ").trim().split(",");
            for (let i = 0; i < groups.length; i++) {
                if (groups[i].indexOf("*") !== -1){
                    throw `Invalid syntax at: SET ${groups[i]}`;
                }
                const values = groups[i].trim().split("=");
                if (values.length === 2) {
                    columns[values[0].trim()] = values[1].trim().replace(/^[\"\']|[\"\']$/g, "");
                } else if (values.length === 1) {
                    columns["*"] = values[0].trim().replace(/^[\"\']|[\"\']$/g, "");
                } else {
                    throw `Invalid syntax at: SET ${values.join(" ")}`;
                }
            }
        }
        for (const column in columns) {
            query.set[column] = columns[column];
        }
    }

    private parseWhereSegment(segments: Array<string>, query: Query) {
        if (segments.length < 2) {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else {
            query.where = [];
            segments.splice(0, 1);
            const groups:Array<any> = [];
            let openParentheses = 0;
            for (let i = segments.length - 1; i >= 0; i--) {
                let index = -1;
                openParentheses += (segments[i].match(/\)/g) || []).length;
                openParentheses -= (segments[i].match(/\(/g) || []).length;
                switch (segments[i].toUpperCase()) {
                    case "OR":
                        if (openParentheses === 0) {
                            index = i;
                        }
                        break;
                    default:
                        break;
                }
                if (index !== -1) {
                    groups.push(segments.splice(index, segments.length));
                } else if (i === 0) {
                    groups.push(segments.splice(0, segments.length));
                }
            }

            groups.reverse();

            for (let i = 0; i < groups.length; i++) {
                if (groups[i][0].toUpperCase() === "OR") {
                    groups[i].splice(0, 1);
                }
            }

            for (let i = 0; i < groups.length; i++) {
                let statement = groups[i]
                                    .join(" ")
                                    .trim()
                                    .replace(/^\(|\)$/g, "")
                                    .trim();
                groups.splice(i, 1, statement);
            }

            const conditions:Array<Condition> = [];
            for (let i = 0; i < groups.length; i++) {
                const condition = this.buildConditions(groups[i]);
                conditions.push(condition);
            }

            query.where = conditions;

            for (let i = 0; i < query.where.length; i++) {
                for (let k = 0; k < query.where[i].checks.length; k++) {
                    if (Array.isArray(query.where[i].checks[k])) {
                        for (
                            let c = 0;
                            // @ts-ignore
                            c < query.where[i].checks[k].length;
                            c++
                        ) {
                            const check = query.where[i].checks[k][c] as Check;
                            query.where[i].checks[k][c].value = check.value;
                            query.where[i].checks[k][c].column = check.column;
                        }
                    } else {
                        const check = query.where[i].checks[k] as Check;
                        // @ts-ignore
                        query.where[i].checks[k].value = check.value;
                        // @ts-ignore
                        query.where[i].checks[k].column = check.column;
                    }
                }
            }
        }
    }

    private buildConditions(statement: string): Condition {
        const condition: Condition = {
            requireAll: true,
            checks: [],
        };
        let statements:Array<any> = [];
        if (statement.search(/\bOR\b/i) !== -1) {
            condition.requireAll = false;
            statements = statement.split(/\bOR\b/i);
            for (let i = 0; i < statements.length; i++) {
                if (statements[i].search(/\bAND\b/i) !== -1) {
                    statements.splice(i, 1, statements[i].split(/\bAND\b/i));
                }
            }
        } else {
            statements = statement.split(/\bAND\b/i);
        }
        for (let i = 0; i < statements.length; i++) {
            condition.checks.push(this.buildConditionCheck(statements[i]));
        }
        return condition;
    }

    private buildConditionCheckFormat(statement: string): {
        format: Format | null;
        statement: string;
    } {
        let format:Format|null = null;
        if (statement.indexOf("~") !== -1) {
            const type = statement
                .match(/\bDATE\b|\bBOOL\b|\bINT\b|\bJSON\b/i)?.[0]
                .trim()
                .toUpperCase() as FormatType;
            const column = statement
                .match(/\~.*?(\~|\>)/)?.[0]
                .replace(/\~|\>/g, "")
                .trim() || "";
            let args:string|null = null;
            if (type === "DATE") {
                args =
                    statement
                        .match(/\>.*?\~/)?.[0]
                        .replace(/\~|\+|\>|\'|\"/g, "")
                        .trim() || null;
                if (args === null) {
                    throw `Invalid DATE function syntax. You must provide a format string.`;
                }
            }
            statement = statement.replace(/(\bDATE\b|\bBOOL\b|\bINT\b|\bJSON\b).*\~/i, column);
            format = {
                type: type,
                args: args,
            };
        }
        return {
            format: format,
            statement: statement,
        };
    }

    private buildConditionCheck(statement:string): Check | Array<Check> {
        let result:Check|Check[];
        if (Array.isArray(statement)) {
            result = [];
            for (let i = 0; i < statement.length; i++) {
                const check: Check = {
                    column: "",
                    type: "=",
                    value: null,
                    format: null,
                };
                statement[i] = statement[i].trim().replace(/\'|\"/g, "");
                const { format, statement: s } = this.buildConditionCheckFormat(statement[i]);
                statement[i] = s;
                check.format = format;
                check.type = statement[i].match(CONDITIONS).join("").trim();
                const values = statement[i].split(check.type);
                check.column = values[0];
                check.value = values[1];
                result.push(check);
            }
        } else {
            const check: Check = {
                column: "",
                type: "=",
                value: null,
                format: null,
            };
            statement = statement.trim().replace(/\'|\"/g, "");
            const { format, statement: s } = this.buildConditionCheckFormat(statement);
            statement = s;
            check.format = format;
            check.type = statement?.match(CONDITIONS)?.join("")?.trim() as CheckOperation;
            const values = statement.split(check.type);
            check.column = values[0].trim();
            check.value = values[1].trim();
            result = check;
        }
        return result;
    }

    private parseGroupBySegment(segments: Array<string>, query: Query) {
        if (segments.length !== 3) {
            throw `Invalid syntax. GROUP BY only currently supports single column sorting.`;
        }
        if (query.uniqueOnly) {
            throw `Invalid syntax. GROUP BY can not be used with UNIQUE or DISTINCT statements.`;
        }
        query.group = segments[2];
    }

    private parseOrderBySegment(segments: Array<string>, query: Query) {
        if (segments.length < 3 || segments[1] !== "BY") {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else {
            segments.splice(0, 2);
            if (segments.length > 2 || segments[0].indexOf(",") !== -1) {
                throw `Invalid syntax. ORDER BY only currently supports single column sorting.`;
            } else {
                let sort = "ASC";
                if (segments?.[1]) {
                    sort = segments[1].toUpperCase();
                    if (sort !== "ASC" && sort !== "DESC") {
                        throw `Invalid syntax. ORDER BY only currently supports ASC or DESC sorting.`;
                    }
                }
                query.order = {
                    column: segments[0],
                    // @ts-ignore
                    by: sort,
                };
            }
        }
    }

    private injectValues(query:Query){
        // Column Alias
        if (query?.columnAlias?.length){
            for (let i = 0; i < query.columnAlias.length; i++){
                query.columnAlias[i].column = this.inject(query.columnAlias[i].column);
                query.columnAlias[i].alias = this.inject(query.columnAlias[i].alias);
            }
        }
        // Columns 
        if (query?.columns){
            for (let i = 0; i < query.columns?.length; i++){
                query.columns[i] = this.inject(query.columns[i]);
            }
        }
        // Values
        if (query?.values){
            for (let i = 0; i < query.values?.length; i++){
                query.values[i] = this.inject(query.values[i]);
            }
        }
        // Set
        if (Object.keys(query.set || {})?.length){
            const obj = {};
            for (const key in query.set){
                obj[this.inject(key)] = this.inject(query.set[key]);
            }
            query.set = obj;
        }
        // Where columns or values
        if (query?.where){
            for (let i = 0; i < query.where?.length; i++){
                for (let c = 0; c < query.where[i].checks.length; c++){
                    if (Array.isArray(query.where[i].checks[c])){
                        // @ts-expect-error
                        for (let j = 0; j < query.where[i].checks[c].length; j++){
                            query.where[i].checks[c][j].column = this.inject(query.where[i].checks[c][j].column);
                            query.where[i].checks[c][j].value = this.inject(query.where[i].checks[c][j].value);
                        }
                    } else {
                        // @ts-expect-error
                        query.where[i].checks[c].column = this.inject(query.where[i].checks[c].column);
                        // @ts-expect-error
                        query.where[i].checks[c].value = this.inject(query.where[i].checks[c].value);
                    }
                }
            }
        }
        // Other
        if (query.order?.column){
            query.order.column = this.inject(query.order.column);
        }
        query.table = this.inject(query.table);
        query.group = this.inject(query.group);
    }

    private inject(value: string|number|null) {
        if (value === null){
            return value;
        }
        if (typeof value === "string" && value.toString().indexOf("$") === 0) {
            const key = value.substring(1, value.length);
            if (key in this.params) {
                return this.params[key];
            } else {
                throw `Invalid params. Missing key: ${key}`;
            }
        } else if (typeof value === "string") {
            value = value.replace(/\bcount\b|\bmin\b|\bmax\b|\bavg\b|\bsum\b|\(|\)|\[|\]/gi, "").trim();
        }
        return value;
    }

    private washStatement() {
        // Replace NOW() functions
        const nowFunctions: Array<string> = this.query.match(/\bNOW\b\(.*?\)/gi) || [];
        for (let i = 0; i < nowFunctions.length; i++) {
            const format =
                nowFunctions[i]
                    .replace(/\'|\"/g, "")
                    .trim()
                    .match(/(?<=\().*(?=\))/g)?.[0] || null;
            const uid = uuid().replace(/\-/g, "");
            this.query = this.query.replace(nowFunctions[i], `$${uid}`);
            if (format === null || format === "u") {
                this.params[uid] = Date.now();
            } else if (format === "U") {
                this.params[uid] = dayjs().unix();
            } else if (format === "c") {
                this.params[uid] = dayjs().toISOString();
            } else {
                this.params[uid] = dayjs().format(format);
            }
        }

        // Replace DATE() functions
        const dateFunctions = this.query.match(/\bDATE\b\(.*?\)/gi) || [];
        for (let i = 0; i < dateFunctions.length; i++) {
            const cleanValue = dateFunctions[i].replace(/\(|\)/g, "~").replace(/\'|\"/g, "").replace(/\s+/g, "").replace(/\,/g, ">");
            this.query = this.query.replace(dateFunctions[i], cleanValue);
        }

        // Replace INT() functions
        const intFunctions = this.query.match(/\bINT\b\(.*?\)/gi) || [];
        for (let i = 0; i < intFunctions.length; i++) {
            const cleanValue = intFunctions[i].replace(/\(|\)/g, "~");
            this.query = this.query.replace(intFunctions[i], cleanValue);
        }

        // Repalce FLOAT() functions
        const floatFunctions = this.query.match(/\bFLOAT\b\(.*?\)/gi) || [];
        for (let i = 0; i < floatFunctions.length; i++) {
            const cleanValue = floatFunctions[i].replace(/\(|\)/g, "~");
            this.query = this.query.replace(floatFunctions[i], cleanValue);
        }

        // Replace BOOL() functions
        const boolFunctions = this.query.match(/\bBOOL\b\(.*?\)/gi) || [];
        for (let i = 0; i < boolFunctions.length; i++) {
            const cleanValue = boolFunctions[i].replace(/\(|\)/g, "~");
            this.query = this.query.replace(boolFunctions[i], cleanValue);
        }

        // Replace JSON() functions
        const jsonFunctions = this.query.match(/\bJSON\b\(.*?\)/gi) || [];
        for (let i = 0; i < jsonFunctions.length; i++) {
            const cleanValue = jsonFunctions[i].replace(/\(|\)/g, "~");
            this.query = this.query.replace(jsonFunctions[i], cleanValue);
        }
    }
}
