use crate::tables::*;
use spacetimedb::{reducer, ReducerContext, Table};

#[reducer]
pub fn run_pending_migrations(_ctx: &ReducerContext) -> Result<(), String> {
    // Append steps as: run_step(ctx, "some_backfill_v1", |ctx| { ... }).
    Ok(())
}

#[allow(dead_code)]
fn run_step(
    ctx: &ReducerContext,
    step_key: &str,
    step: impl FnOnce(&ReducerContext) -> Result<(), String>,
) -> Result<(), String> {
    let step_key = step_key.to_string();
    if ctx
        .db
        .migration_state()
        .step_key()
        .find(&step_key)
        .is_some()
    {
        return Ok(());
    }

    step(ctx)?;
    ctx.db.migration_state().insert(MigrationState {
        step_key,
        applied_at: ctx.timestamp,
    });
    Ok(())
}
