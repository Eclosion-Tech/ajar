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
    validate_transform(&[x, z])?;

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
    validate_transform(&[x, y, z, rot_y])?;

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

#[reducer]
pub fn import_walls(
    ctx: &ReducerContext,
    table_id: u64,
    walls: Vec<WallInput>,
) -> Result<(), String> {
    require_table_dm(ctx, table_id)?;
    if walls.len() > 4096 {
        return Err("cannot import more than 4096 walls".to_string());
    }

    delete_walls(ctx, table_id);
    for wall in walls {
        ctx.db.wall().insert(Wall {
            id: 0,
            table_id,
            ax: wall.ax,
            az: wall.az,
            bx: wall.bx,
            bz: wall.bz,
            height: wall.height,
            thickness: wall.thickness,
        });
    }
    Ok(())
}

#[reducer]
pub fn clear_walls(ctx: &ReducerContext, table_id: u64) -> Result<(), String> {
    require_table_dm(ctx, table_id)?;
    delete_walls(ctx, table_id);
    Ok(())
}

#[reducer]
pub fn import_lights(
    ctx: &ReducerContext,
    table_id: u64,
    lights: Vec<LightInput>,
) -> Result<(), String> {
    require_table_dm(ctx, table_id)?;
    if lights.len() > 1024 {
        return Err("cannot import more than 1024 lights".to_string());
    }

    delete_lights(ctx, table_id);
    for light in lights {
        ctx.db.light().insert(Light {
            id: 0,
            table_id,
            x: light.x,
            z: light.z,
            range: light.range,
            intensity: light.intensity,
            color_rgb: light.color_rgb,
        });
    }
    Ok(())
}

#[reducer]
pub fn clear_lights(ctx: &ReducerContext, table_id: u64) -> Result<(), String> {
    require_table_dm(ctx, table_id)?;
    delete_lights(ctx, table_id);
    Ok(())
}

#[reducer]
pub fn set_map_image(
    ctx: &ReducerContext,
    table_id: u64,
    url: String,
    width: f32,
    height: f32,
    offset_x: f32,
    offset_z: f32,
) -> Result<(), String> {
    require_table_dm(ctx, table_id)?;

    if let Some(mut map_image) = ctx.db.map_image().table_id().filter(table_id).next() {
        map_image.url = url;
        map_image.width = width;
        map_image.height = height;
        map_image.offset_x = offset_x;
        map_image.offset_z = offset_z;
        ctx.db.map_image().id().update(map_image);
    } else {
        ctx.db.map_image().insert(MapImage {
            id: 0,
            table_id,
            url,
            width,
            height,
            offset_x,
            offset_z,
        });
    }
    Ok(())
}

#[reducer]
pub fn clear_map_image(ctx: &ReducerContext, table_id: u64) -> Result<(), String> {
    require_table_dm(ctx, table_id)?;
    delete_map_images(ctx, table_id);
    Ok(())
}

#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn spawn_prop(
    ctx: &ReducerContext,
    table_id: u64,
    kind: String,
    params: String,
    seed: u64,
    x: f32,
    z: f32,
    rot_y: f32,
) -> Result<(), String> {
    let table = require_table_dm(ctx, table_id)?;
    if params.len() > 4096 {
        return Err("prop params cannot exceed 4096 bytes".to_string());
    }
    validate_transform(&[x, z, rot_y])?;

    ctx.db.prop().insert(Prop {
        id: 0,
        table_id,
        dm_identity: table.dm_identity,
        kind,
        params,
        seed,
        x,
        z,
        rot_y,
        hidden: false,
    });
    Ok(())
}

#[reducer]
pub fn update_prop_params(
    ctx: &ReducerContext,
    prop_id: u64,
    params: String,
) -> Result<(), String> {
    let mut prop = find_prop(ctx, prop_id)?;
    require_table_dm(ctx, prop.table_id)?;
    if params.len() > 4096 {
        return Err("prop params cannot exceed 4096 bytes".to_string());
    }

    prop.params = params;
    ctx.db.prop().id().update(prop);
    Ok(())
}

#[reducer]
pub fn move_prop(
    ctx: &ReducerContext,
    prop_id: u64,
    x: f32,
    z: f32,
    rot_y: f32,
) -> Result<(), String> {
    let mut prop = find_prop(ctx, prop_id)?;
    require_table_dm(ctx, prop.table_id)?;
    validate_transform(&[x, z, rot_y])?;

    prop.x = x;
    prop.z = z;
    prop.rot_y = rot_y;
    ctx.db.prop().id().update(prop);
    Ok(())
}

#[reducer]
pub fn set_prop_hidden(ctx: &ReducerContext, prop_id: u64, hidden: bool) -> Result<(), String> {
    let mut prop = find_prop(ctx, prop_id)?;
    require_table_dm(ctx, prop.table_id)?;

    prop.hidden = hidden;
    ctx.db.prop().id().update(prop);
    Ok(())
}

#[reducer]
pub fn delete_prop(ctx: &ReducerContext, prop_id: u64) -> Result<(), String> {
    let prop = find_prop(ctx, prop_id)?;
    require_table_dm(ctx, prop.table_id)?;
    ctx.db.prop().id().delete(prop_id);
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

fn find_prop(ctx: &ReducerContext, prop_id: u64) -> Result<Prop, String> {
    ctx.db
        .prop()
        .id()
        .find(prop_id)
        .ok_or_else(|| "prop not found".to_string())
}

fn validate_transform(values: &[f32]) -> Result<(), String> {
    if values.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err("position and rotation values must be finite".to_string())
    }
}

fn delete_walls(ctx: &ReducerContext, table_id: u64) {
    let wall_ids: Vec<_> = ctx
        .db
        .wall()
        .table_id()
        .filter(table_id)
        .map(|wall| wall.id)
        .collect();

    for wall_id in wall_ids {
        ctx.db.wall().id().delete(wall_id);
    }
}

fn delete_lights(ctx: &ReducerContext, table_id: u64) {
    let light_ids: Vec<_> = ctx
        .db
        .light()
        .table_id()
        .filter(table_id)
        .map(|light| light.id)
        .collect();

    for light_id in light_ids {
        ctx.db.light().id().delete(light_id);
    }
}

fn delete_map_images(ctx: &ReducerContext, table_id: u64) {
    let map_image_ids: Vec<_> = ctx
        .db
        .map_image()
        .table_id()
        .filter(table_id)
        .map(|map_image| map_image.id)
        .collect();

    for map_image_id in map_image_ids {
        ctx.db.map_image().id().delete(map_image_id);
    }
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
