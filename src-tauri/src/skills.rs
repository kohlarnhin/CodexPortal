use serde::Serialize;
use std::fs;
use std::path::PathBuf;

// ==================== Skills（~/.agents/skills）管理 ====================

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SkillInfo {
    /// 展示名（frontmatter name，缺失时用目录名）。
    pub(crate) name: String,
    /// 目录名（操作 key：详情/删除一律用目录名，避免 frontmatter 与目录不一致）。
    #[serde(rename = "dirName")]
    pub(crate) dir_name: String,
    pub(crate) description: String,
    #[serde(rename = "isSymlink")]
    pub(crate) is_symlink: bool,
    pub(crate) path: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SkillDetail {
    pub(crate) name: String,
    #[serde(rename = "dirName")]
    pub(crate) dir_name: String,
    pub(crate) description: String,
    #[serde(rename = "isSymlink")]
    pub(crate) is_symlink: bool,
    pub(crate) path: String,
    #[serde(rename = "fileCount")]
    pub(crate) file_count: usize,
    /// SKILL.md 全文。
    pub(crate) content: String,
}

/// Skill 目录名必须是单个目录段（无路径分隔符、无 `.`/`..`），防路径遍历。
fn is_valid_skill_dir_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && name != "." && name != ".."
}

/// Codex 主要读取的 skills 目录。
fn skills_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    Ok(home.join(".agents").join("skills"))
}

/// 解析 SKILL.md 的 frontmatter（首尾 `---` 之间的 YAML 键值），提取 name / description。
/// 不引入 YAML 库，仅按 "key: value" 简单解析（支持引号包裹的值）。
fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    let Some(rest) = trimmed.strip_prefix("---") else {
        return (None, None);
    };
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };
    let mut name = None;
    let mut description = None;
    for line in rest[..end].lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key {
            "name" if name.is_none() => name = Some(value),
            "description" if description.is_none() => description = Some(value),
            _ => {}
        }
    }
    (name, description)
}

/// 读取一个 skill 目录的摘要信息（不读全文）。
fn read_skill_info(dir: &PathBuf) -> Option<SkillInfo> {
    let skill_md = dir.join("SKILL.md");
    let content = fs::read_to_string(&skill_md).ok()?;
    let (front_name, description) = parse_skill_frontmatter(&content);
    let dir_name = dir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if !is_valid_skill_dir_name(&dir_name) {
        return None;
    }
    let name = front_name
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| dir_name.clone());
    Some(SkillInfo {
        name,
        dir_name,
        description: description.unwrap_or_default(),
        is_symlink: fs::symlink_metadata(dir)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false),
        path: dir.to_string_lossy().to_string(),
    })
}

/// 扫描 skills 根目录下的所有 skill（目录或软链接，须含 SKILL.md）。
fn scan_skills(root: &PathBuf) -> Vec<SkillInfo> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut skills = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(info) = read_skill_info(&path) {
                skills.push(info);
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// 列出 ~/.agents/skills 下的全部 skill。
#[tauri::command]
pub(crate) fn list_skills() -> Result<Vec<SkillInfo>, String> {
    let dir = skills_dir()?;
    Ok(scan_skills(&dir))
}

/// 读取单个 skill 的详情（SKILL.md 全文 + 目录内文件数）。
#[tauri::command]
pub(crate) fn get_skill_detail(name: String) -> Result<SkillDetail, String> {
    if !is_valid_skill_dir_name(&name) {
        return Err("Skill 名称无效".to_string());
    }
    let dir = skills_dir()?.join(&name);
    if !dir.is_dir() {
        return Err(format!("Skill \"{name}\" 不存在"));
    }
    let content = fs::read_to_string(dir.join("SKILL.md"))
        .map_err(|_| format!("Skill \"{name}\" 缺少 SKILL.md"))?;
    let info = read_skill_info(&dir).ok_or_else(|| format!("Skill \"{name}\" 读取失败"))?;
    let file_count = count_files(&dir);
    Ok(SkillDetail {
        name: info.name,
        dir_name: info.dir_name,
        description: info.description,
        is_symlink: info.is_symlink,
        path: info.path,
        file_count,
        content,
    })
}

/// 判断路径是否为"不跟随符号链接"的目录（软链 skill 顶层允许，递归内容不跟随）。
fn is_dir_no_follow(path: &PathBuf) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_dir())
        .unwrap_or(false)
}

/// 递归统计目录内文件数量（不跟随符号链接，防止链接循环导致栈溢出）。
fn count_files(dir: &PathBuf) -> usize {
    fn walk(dir: &PathBuf, count: &mut usize) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            // 符号链接一律跳过（不跟随、不计数），避免循环与误统计外部目录。
            if fs::symlink_metadata(&path)
                .map(|meta| meta.file_type().is_symlink())
                .unwrap_or(false)
            {
                continue;
            }
            if is_dir_no_follow(&path) {
                walk(&path, count);
            } else {
                *count += 1;
            }
        }
    }
    let mut count = 0usize;
    walk(dir, &mut count);
    count
}

/// 把源目录复制为 skill 添加到 skills 根目录（源目录须含 SKILL.md，名称冲突时报错）。
fn add_skill_to(root: &PathBuf, source: &PathBuf) -> Result<SkillInfo, String> {
    if !source.is_dir() {
        return Err("源目录不存在".to_string());
    }
    let source_name = source
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "无法识别源目录名称".to_string())?;
    if !is_valid_skill_dir_name(&source_name) {
        return Err("源目录名称无效".to_string());
    }
    if !source.join("SKILL.md").is_file() {
        return Err("源目录缺少 SKILL.md，不是有效的 Skill".to_string());
    }
    let target = root.join(&source_name);
    if target.exists() {
        return Err(format!("Skill \"{source_name}\" 已存在"));
    }
    copy_dir_recursive(source, &target)?;
    read_skill_info(&target).ok_or_else(|| "Skill 添加失败".to_string())
}

/// 递归复制目录（不跟随符号链接：跳过链接条目，防止循环与复制外部目录）。
fn copy_dir_recursive(source: &PathBuf, target: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let entries = fs::read_dir(source).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let from = entry.path();
        let to = target.join(entry.file_name());
        if fs::symlink_metadata(&from)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue; // 跳过符号链接
        }
        if is_dir_no_follow(&from) {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 从 skills 根目录删除 skill（软链接只删除链接本身）。
fn delete_skill_from(root: &PathBuf, name: &str) -> Result<(), String> {
    if !is_valid_skill_dir_name(name) {
        return Err("Skill 名称无效".to_string());
    }
    let target = root.join(name);
    if !target.exists() {
        return Err(format!("Skill \"{name}\" 不存在"));
    }
    let is_symlink = fs::symlink_metadata(&target)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    if is_symlink {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 从本地目录添加 skill 到 ~/.agents/skills（复制）。
#[tauri::command]
pub(crate) fn add_skill(source_path: String) -> Result<SkillInfo, String> {
    let root = skills_dir()?;
    add_skill_to(&root, &PathBuf::from(source_path.trim()))
}

/// 删除 ~/.agents/skills 下的 skill。
#[tauri::command]
pub(crate) fn delete_skill(name: String) -> Result<(), String> {
    let root = skills_dir()?;
    delete_skill_from(&root, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn is_valid_skill_dir_name_rejects_traversal() {
        assert!(is_valid_skill_dir_name("my-skill"));
        assert!(is_valid_skill_dir_name("a-b-c"));
        assert!(!is_valid_skill_dir_name(".."));
        assert!(!is_valid_skill_dir_name("."));
        assert!(!is_valid_skill_dir_name("a/b"));
        assert!(!is_valid_skill_dir_name("a\\b"));
        assert!(!is_valid_skill_dir_name(""));
    }

    #[test]
    fn parse_skill_frontmatter_extracts_fields() {
        let content = "---\nname: find-skills\ndescription: \"Helps users discover and install skills\"\n---\n\n# Find Skills\nBody...";
        let (name, description) = parse_skill_frontmatter(content);
        assert_eq!(name.as_deref(), Some("find-skills"));
        assert_eq!(
            description.as_deref(),
            Some("Helps users discover and install skills")
        );
    }

    #[test]
    fn parse_skill_frontmatter_no_frontmatter() {
        assert_eq!(parse_skill_frontmatter("# Just a heading"), (None, None));
        assert_eq!(parse_skill_frontmatter(""), (None, None));
        // 未闭合的 frontmatter。
        assert_eq!(parse_skill_frontmatter("---\nname: x"), (None, None));
    }

    #[test]
    fn add_and_delete_skill_on_temp_dir() {
        let root = std::env::temp_dir().join(format!("codex-skills-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        // 源目录放在 root 之外，避免与目标路径重合。
        let staging = root.join("staging");
        fs::create_dir_all(&staging).unwrap();
        let source = staging.join("my-skill");
        fs::create_dir_all(source.join("references")).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\n# My Skill",
        )
        .unwrap();
        fs::write(source.join("references").join("guide.md"), "guide").unwrap();

        // 添加：复制到 root。
        let info = add_skill_to(&root, &source).unwrap();
        assert_eq!(info.name, "my-skill");
        assert!(root.join("my-skill").join("SKILL.md").is_file());
        assert!(root
            .join("my-skill")
            .join("references")
            .join("guide.md")
            .is_file());
        // 重复添加报错。
        assert!(add_skill_to(&root, &source).is_err());
        // 缺少 SKILL.md 的目录拒绝。
        let bad = staging.join("bad-skill");
        fs::create_dir_all(&bad).unwrap();
        assert!(add_skill_to(&root, &bad).is_err());

        // 删除。
        delete_skill_from(&root, "my-skill").unwrap();
        assert!(!root.join("my-skill").exists());
        assert!(delete_skill_from(&root, "my-skill").is_err());

        // 软链接 skill 删除只删链接。
        let symlink_target = source.clone();
        std::os::unix::fs::symlink(&symlink_target, root.join("linked-skill")).unwrap();
        let linked = read_skill_info(&root.join("linked-skill")).unwrap();
        assert!(linked.is_symlink);
        delete_skill_from(&root, "linked-skill").unwrap();
        assert!(!root.join("linked-skill").exists());
        assert!(source.exists(), "软链接指向的源目录不应被删除");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn scan_skills_sorts_and_reads_frontmatter() {
        let root = std::env::temp_dir().join(format!("codex-skills-scan-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for (name, description) in [("b-skill", "second"), ("a-skill", "first")] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: {description}\n---\n# {name}"),
            )
            .unwrap();
        }
        // 无 SKILL.md 的目录不应出现在列表。
        fs::create_dir_all(root.join("no-skill-md")).unwrap();

        let skills = scan_skills(&root);
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["a-skill", "b-skill"]);
        assert_eq!(skills[0].description, "first");
        fs::remove_dir_all(&root).unwrap();
    }
}
