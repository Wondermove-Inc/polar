use polar::{parse_id, registered_root, request_launch, scan};
use std::{
    env,
    ffi::OsString,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
};

const USAGE: &str = "Usage: polar list | polar --steam-root <path> list | polar launch <AppID>";

fn run(args: &[OsString]) -> Result<u8, String> {
    let root = match args {
        [cmd] if cmd == "list" => registered_root()?,
        [option, path, cmd] if option == "--steam-root" && !path.is_empty() && cmd == "list" => {
            PathBuf::from(path)
        }
        [cmd, raw] if cmd == "launch" => {
            let id = raw.to_str().and_then(parse_id).ok_or(USAGE)?;
            request_launch(id)?;
            println!("Launch request sent to Steam for {id}.");
            return Ok(0);
        }
        _ => return Err(USAGE.into()),
    };
    let report = scan(&root);
    let mut output = io::stdout().lock();
    for game in report.games {
        writeln!(output, "{}\t{}", game.id, game.name).map_err(|e| e.to_string())?;
    }
    for warning in &report.warnings {
        eprintln!("{warning}");
    }
    Ok(if report.libraries_read == 0 {
        1
    } else if report.warnings.is_empty() {
        0
    } else {
        2
    })
}

fn main() -> ExitCode {
    match run(&env::args_os().skip(1).collect::<Vec<_>>()) {
        Ok(code) => ExitCode::from(code),
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
