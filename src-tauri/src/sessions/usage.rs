use crate::sessions::parser::project_display_name;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ProjectTokenUsage {
    #[serde(rename = "projectPath")]
    pub(crate) project_path: String,
    pub(crate) name: String,
    #[serde(rename = "sessionCount")]
    pub(crate) session_count: i64,
    #[serde(rename = "totalTokens")]
    pub(crate) total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ModelTokenUsage {
    pub(crate) model: String,
    #[serde(rename = "sessionCount")]
    pub(crate) session_count: i64,
    #[serde(rename = "totalTokens")]
    pub(crate) total_tokens: i64,
    #[serde(rename = "inputTokens")]
    pub(crate) input_tokens: i64,
    #[serde(rename = "cachedInputTokens")]
    pub(crate) cached_input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub(crate) output_tokens: i64,
    #[serde(rename = "reasoningTokens")]
    pub(crate) reasoning_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DailyTokenUsage {
    pub(crate) date: String,
    #[serde(rename = "totalTokens")]
    pub(crate) total_tokens: i64,
    #[serde(rename = "inputTokens")]
    pub(crate) input_tokens: i64,
    #[serde(rename = "cachedInputTokens")]
    pub(crate) cached_input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub(crate) output_tokens: i64,
    #[serde(rename = "reasoningTokens")]
    pub(crate) reasoning_tokens: i64,
    /// 当日按项目分布（按 token 降序）。
    pub(crate) projects: Vec<ProjectTokenUsage>,
    /// 当日按模型分布（按 token 降序）。
    pub(crate) models: Vec<ModelTokenUsage>,
}

fn is_date_str(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| byte.is_ascii_digit() || index == 4 || index == 7)
}

/// 查询指定日期范围内每天的 token 用量；省略日期边界时查询全部历史。
/// 每天附带按项目与按模型的分布，供「Token 用量」页面展示。
#[tauri::command]
pub(crate) async fn get_token_usage(
    app: tauri::AppHandle,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<DailyTokenUsage>, String> {
    crate::db::with_db(app, move |db| {
        query_token_usage(db, start_date.as_deref(), end_date.as_deref())
    })
    .await
}

fn query_token_usage(
    db: &rusqlite::Connection,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<DailyTokenUsage>, String> {
    if start_date.is_some_and(|date| !is_date_str(date))
        || end_date.is_some_and(|date| !is_date_str(date))
    {
        return Err("日期格式无效，应为 YYYY-MM-DD".to_string());
    }
    if matches!((start_date, end_date), (Some(start), Some(end)) if start > end) {
        return Err("起始日期不能晚于结束日期".to_string());
    }

    let mut days: Vec<DailyTokenUsage> = Vec::new();
    {
        let mut stmt = db
            .prepare(
                "SELECT date, SUM(total_tokens), SUM(input_tokens), SUM(cached_input_tokens), SUM(output_tokens), SUM(reasoning_tokens) FROM session_daily_tokens WHERE (?1 IS NULL OR date >= ?1) AND (?2 IS NULL OR date <= ?2) GROUP BY date ORDER BY date",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_date, end_date], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (date, total, input, cached, output, reasoning) = row.map_err(|e| e.to_string())?;
            days.push(DailyTokenUsage {
                date,
                total_tokens: total,
                input_tokens: input,
                cached_input_tokens: cached,
                output_tokens: output,
                reasoning_tokens: reasoning,
                projects: Vec::new(),
                models: Vec::new(),
            });
        }
    }

    // 按项目分布。
    {
        let mut stmt = db
            .prepare(
                "SELECT date, project_path, COUNT(DISTINCT session_id), SUM(total_tokens) FROM session_daily_tokens WHERE (?1 IS NULL OR date >= ?1) AND (?2 IS NULL OR date <= ?2) GROUP BY date, project_path ORDER BY date, SUM(total_tokens) DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_date, end_date], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut by_date: HashMap<String, Vec<ProjectTokenUsage>> = HashMap::new();
        for row in rows {
            let (date, path, count, total) = row.map_err(|e| e.to_string())?;
            by_date.entry(date).or_default().push(ProjectTokenUsage {
                name: project_display_name(&path),
                project_path: path,
                session_count: count,
                total_tokens: total,
            });
        }
        for day in &mut days {
            if let Some(projects) = by_date.remove(&day.date) {
                day.projects = projects;
            }
        }
    }

    // 按模型分布（含各维度 token 细分，供前端按单价实时计算金额）。
    {
        let mut stmt = db
            .prepare(
                "SELECT date, COALESCE(model, '未知'), COUNT(DISTINCT session_id), SUM(total_tokens), SUM(input_tokens), SUM(cached_input_tokens), SUM(output_tokens), SUM(reasoning_tokens) FROM session_daily_tokens WHERE (?1 IS NULL OR date >= ?1) AND (?2 IS NULL OR date <= ?2) GROUP BY date, COALESCE(model, '未知') ORDER BY date, SUM(total_tokens) DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_date, end_date], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut by_date: HashMap<String, Vec<ModelTokenUsage>> = HashMap::new();
        for row in rows {
            let (date, model, count, total, input, cached, output, reasoning) =
                row.map_err(|e| e.to_string())?;
            by_date.entry(date).or_default().push(ModelTokenUsage {
                model,
                session_count: count,
                total_tokens: total,
                input_tokens: input,
                cached_input_tokens: cached,
                output_tokens: output,
                reasoning_tokens: reasoning,
            });
        }
        for day in &mut days {
            if let Some(models) = by_date.remove(&day.date) {
                day.models = models;
            }
        }
    }

    Ok(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_date_str_validates_ymd() {
        assert!(is_date_str("2026-08-12"));
        assert!(!is_date_str("2026-8-12"));
        assert!(!is_date_str("20260812"));
        assert!(!is_date_str("2026-08-1"));
        assert!(!is_date_str(""));
    }
}
