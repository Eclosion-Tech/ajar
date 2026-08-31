use crate::tables::*;
use spacetimedb::rand::Rng;
use spacetimedb::{reducer, ReducerContext, Table, TryInsertError};

const SLUG_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_ATTEMPTS: usize = 32;

#[reducer]
pub fn create_table(
    ctx: &ReducerContext,
    name: String,
    display_name: String,
) -> Result<(), String> {
    let mut rng = ctx.rng();

    for _ in 0..SLUG_ATTEMPTS {
        let slug: String = (0..6)
            .map(|_| {
                let index = rng.gen_range(0..SLUG_ALPHABET.len());
                SLUG_ALPHABET[index] as char
            })
            .collect();

        let table = GameTable {
            id: 0,
            slug,
            name: name.clone(),
            dm_identity: ctx.sender(),
            created_at: ctx.timestamp,
        };

        let table = match ctx.db.game_table().try_insert(table) {
            Ok(table) => table,
            Err(TryInsertError::UniqueConstraintViolation(_)) => continue,
            Err(error) => return Err(format!("failed to create table: {error}")),
        };

        ctx.db.participant().insert(Participant {
            id: 0,
            table_id: table.id,
            identity: ctx.sender(),
            display_name,
            role: Role::Dm,
            online: true,
        });
        return Ok(());
    }

    Err("failed to generate a unique table slug".to_string())
}

#[reducer]
pub fn join_table(ctx: &ReducerContext, slug: String, display_name: String) -> Result<(), String> {
    let table = ctx
        .db
        .game_table()
        .slug()
        .find(&slug)
        .ok_or_else(|| "table not found".to_string())?;
    let role = if ctx.sender() == table.dm_identity {
        Role::Dm
    } else {
        Role::Player
    };

    let participant = ctx
        .db
        .participant()
        .table_id()
        .filter(table.id)
        .find(|participant| participant.identity == ctx.sender());

    if let Some(mut participant) = participant {
        participant.display_name = display_name;
        participant.role = role;
        participant.online = true;
        ctx.db.participant().id().update(participant);
    } else {
        ctx.db.participant().insert(Participant {
            id: 0,
            table_id: table.id,
            identity: ctx.sender(),
            display_name,
            role,
            online: true,
        });
    }

    Ok(())
}

#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn spawn_entity(
    ctx: &ReducerContext,
    table_id: u64,
    kind: EntityKind,
    name: String,
    color: String,
    x: f32,
    z: f32,
    hidden: bool,
) -> Result<(), String> {
    let table = require_table_dm(ctx, table_id)?;

    ctx.db.entity().insert(Entity {
        id: 0,
        table_id,
        dm_identity: table.dm_identity,
        kind,
        name,
        color,
        x,
        y: 0.0,
        z,
        rot_y: 0.0,
        hidden,
        created_by: ctx.sender(),
    });
    Ok(())
}

#[reducer]
pub fn move_entity(
    ctx: &ReducerContext,
    entity_id: u64,
    x: f32,
    y: f32,
    z: f32,
    rot_y: f32,
) -> Result<(), String> {
    let mut entity = find_entity(ctx, entity_id)?;
    let is_online_participant = ctx
        .db
        .participant()
        .table_id()
        .filter(entity.table_id)
        .any(|participant| participant.identity == ctx.sender() && participant.online);

    if !is_online_participant {
        return Err("only online participants can move entities".to_string());
    }
    if entity.hidden && entity.dm_identity != ctx.sender() {
        return Err("only the DM can move hidden entities".to_string());
    }

    entity.x = x;
    entity.y = y;
    entity.z = z;
    entity.rot_y = rot_y;
    ctx.db.entity().id().update(entity);
    Ok(())
}

#[reducer]
pub fn set_entity_hidden(ctx: &ReducerContext, entity_id: u64, hidden: bool) -> Result<(), String> {
    let mut entity = find_entity(ctx, entity_id)?;
    require_table_dm(ctx, entity.table_id)?;

    entity.hidden = hidden;
    ctx.db.entity().id().update(entity);
    Ok(())
}

#[reducer]
pub fn delete_entity(ctx: &ReducerContext, entity_id: u64) -> Result<(), String> {
    let entity = find_entity(ctx, entity_id)?;
    require_table_dm(ctx, entity.table_id)?;
    ctx.db.entity().id().delete(entity_id);
    Ok(())
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) -> Result<(), String> {
    let participants: Vec<_> = ctx
        .db
        .participant()
        .identity()
        .filter(ctx.sender())
        .collect();

    for mut participant in participants {
        if participant.online {
            participant.online = false;
            ctx.db.participant().id().update(participant);
        }
    }
    Ok(())
}

fn find_entity(ctx: &ReducerContext, entity_id: u64) -> Result<Entity, String> {
    ctx.db
        .entity()
        .id()
        .find(entity_id)
        .ok_or_else(|| "entity not found".to_string())
}

fn require_table_dm(ctx: &ReducerContext, table_id: u64) -> Result<GameTable, String> {
    let table = ctx
        .db
        .game_table()
        .id()
        .find(table_id)
        .ok_or_else(|| "table not found".to_string())?;

    if table.dm_identity != ctx.sender() {
        return Err("only the DM can perform this action".to_string());
    }
    Ok(table)
}
