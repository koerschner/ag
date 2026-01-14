---
description: Connect to Snowflake via SnowSQL
argument-hint: [connection-name]
allowed-tools: Bash(snowsql:*)
---

## Snowflake Connection: $1

You are now connected to Snowflake using the connection named "$1".

Available SnowSQL connections in ~/.snowsql/config:
!`grep -E '^\[connections\.' ~/.snowsql/config | sed 's/\[connections\.//' | sed 's/\]//' | tr '\n' ', '`

To run queries, use the snowsql command:
snowsql -c $1 -q "YOUR SQL QUERY HERE"

**Important guidelines:**
- Always use `-c $1` to specify the connection
- Use `-q "query"` for single queries
- For queries returning large results, add `--output-format csv` or `--output-format json`
- Use `LIMIT` clauses when exploring data to avoid overwhelming output
- The connection uses schema from config (typically RETAIL)

**Example usage:**
- List tables: `snowsql -c $1 -q "SHOW TABLES;"`
- Query data: `snowsql -c $1 -q "SELECT * FROM table_name LIMIT 10;"`
- Check warehouse: `snowsql -c $1 -q "SELECT CURRENT_WAREHOUSE();"`

Wait for the user's instructions on what queries to run.
