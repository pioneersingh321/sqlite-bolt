package com.bolt.sqlite;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;

/**
 * BoltNativeDb - Native Android helper for @bolt/sqlite.
 * Allows Android Java / Kotlin background services (e.g. Foreground Services)
 * to read and write to the @bolt/sqlite database easily.
 */
public class BoltNativeDb {
    private final Context context;
    private final String dbName;

    public BoltNativeDb(Context context, String dbName) {
        this.context = context;
        this.dbName = dbName.endsWith("SQLite.db") ? dbName : dbName + "SQLite.db";
    }

    public static BoltNativeDb open(Context context, String dbName) {
        return new BoltNativeDb(context, dbName);
    }

    public SQLiteDatabase getDb() {
        File dbFile = context.getDatabasePath(dbName);
        if (!dbFile.exists()) return null;
        return SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READWRITE);
    }

    /**
     * Query a single string column value from a table.
     * Example: BoltNativeDb.open(context, "suvidha_hrms_v1").getValue("tbl_setting", "value", "option", "forground_service")
     */
    public String getValue(String table, String column, String whereColumn, String whereValue) {
        SQLiteDatabase db = getDb();
        if (db == null) return null;
        String val = null;
        try {
            Cursor cursor = db.rawQuery(
                "SELECT \"" + column + "\" FROM \"" + table + "\" WHERE \"" + whereColumn + "\" = ? LIMIT 1",
                new String[]{ whereValue }
            );
            if (cursor.moveToFirst()) {
                val = cursor.getString(0);
            }
            cursor.close();
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            db.close();
        }
        return val;
    }

    /**
     * Execute a SQL query and return results as a JSONArray.
     */
    public JSONArray queryJSON(String sql, String[] args) {
        SQLiteDatabase db = getDb();
        JSONArray array = new JSONArray();
        if (db == null) return array;
        try {
            Cursor cursor = db.rawQuery(sql, args != null ? args : new String[0]);
            String[] columnNames = cursor.getColumnNames();
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                for (int i = 0; i < columnNames.length; i++) {
                    row.put(columnNames[i], cursor.getString(i));
                }
                array.put(row);
            }
            cursor.close();
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            db.close();
        }
        return array;
    }

    /**
     * Execute an INSERT, UPDATE, or DELETE raw SQL query.
     */
    public void execute(String sql, Object[] args) {
        SQLiteDatabase db = getDb();
        if (db == null) return;
        try {
            if (args != null && args.length > 0) {
                db.execSQL(sql, args);
            } else {
                db.execSQL(sql);
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            db.close();
        }
    }
}
