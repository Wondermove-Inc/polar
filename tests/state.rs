use polar::saved::{Approved, Manual, read_manual, write_manual};
use polar::session::Sessions;
use tempfile::tempdir;

#[test]
fn shortcuts_survive_replacement_and_report_corruption() {
    let tmp = tempdir().unwrap();
    let p = tmp.path().join("data/shortcuts.json");
    assert!(read_manual(&p).unwrap().is_empty());
    let items = [Manual {
        id: "xbox:Demo".into(),
        name: "한글".into(),
        source: "xbox".into(),
        approved: Approved::App("Demo".into()),
    }];
    write_manual(&p, &items).unwrap();
    assert_eq!(read_manual(&p).unwrap()[0].name, "한글");
    write_manual(&p, &[]).unwrap();
    assert!(read_manual(&p).unwrap().is_empty());
    std::fs::write(&p, "broken").unwrap();
    assert!(read_manual(&p).is_err());
    assert_eq!(std::fs::read(&p).unwrap(), b"broken");
}
#[test]
fn requests_do_not_overlap_and_late_status_cannot_change_a_new_session() {
    let sessions = Sessions::default();
    let first = sessions.start("a").unwrap();
    assert!(sessions.start("b").is_err());
    sessions.phase(first, "waiting");
    assert!(sessions.start("b").is_err());
    sessions.phase(first, "unknown");
    let second = sessions.start("b").unwrap();
    sessions.phase(first, "ended");
    assert_eq!(sessions.snapshot().phase, "requesting");
    sessions.phase(second, "failed");
    assert!(sessions.start("a").is_ok());
}

#[test]
fn process_handoffs_do_not_end_the_game_early() {
    use polar::session::Lifetime;
    let mut tracker = Lifetime::default();
    assert_eq!(tracker.observe(0, false), "waiting");
    assert_eq!(tracker.observe(1_000, true), "running");
    assert_eq!(tracker.observe(1_500, false), "running");
    assert_eq!(tracker.observe(3_500, true), "running");
    assert_eq!(tracker.observe(12_000, true), "running");
    assert_eq!(tracker.observe(12_500, false), "running");
    assert_eq!(tracker.observe(18_000, false), "ended");
    let mut brief = Lifetime::default();
    brief.observe(0, true);
    brief.observe(400, false);
    assert_eq!(brief.observe(6_000, false), "unknown");
    assert_eq!(Lifetime::default().observe(46_000, false), "unknown");
}

#[test]
fn steam_tracks_the_selected_app_without_a_matching_game_window() {
    use polar::session::Lifetime;
    let mut game = Lifetime::default();
    assert_eq!(game.observe_with_steam(0, false, Some(false)), "waiting");
    assert_eq!(game.observe_with_steam(1_000, false, Some(true)), "running");
    assert_eq!(game.observe_with_steam(1_450, false, None), "running");
    assert_eq!(
        game.observe_with_steam(2_000, false, Some(false)),
        "running"
    );
    assert_eq!(game.observe_with_steam(7_000, false, Some(false)), "ended");
    assert_eq!(
        Lifetime::default().observe_with_steam(45_000, false, Some(false)),
        "unknown"
    );
}

#[test]
fn a_missing_steam_signal_is_not_a_confirmed_exit() {
    use polar::session::Lifetime;
    let mut game = Lifetime::default();
    assert_eq!(game.observe_with_steam(0, false, Some(true)), "running");
    assert_eq!(game.observe_with_steam(6_000, false, None), "running");
    assert_eq!(game.observe_with_steam(17_000, false, None), "unknown");
}

#[test]
fn steam_handoffs_keep_tracking_a_live_game_process() {
    use polar::session::Lifetime;
    let mut game = Lifetime::default();
    game.observe_with_steam(0, false, Some(true));
    assert_eq!(game.observe_with_steam(500, false, Some(false)), "running");
    assert_eq!(game.observe_with_steam(3_000, true, None), "running");
    assert_eq!(
        game.observe_with_steam(15_000, true, Some(false)),
        "running"
    );
    assert_eq!(game.observe_with_steam(15_500, false, None), "running");
    assert_eq!(game.observe_with_steam(20_500, false, None), "ended");
}
