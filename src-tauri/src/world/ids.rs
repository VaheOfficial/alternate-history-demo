use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

id_type!(SaveId);
id_type!(BranchId);
id_type!(NationId);
id_type!(ProvinceId);
id_type!(UnitId);
id_type!(NpcId);
id_type!(TreatyId);
id_type!(CrisisId);
id_type!(EventId);
id_type!(FrontlineId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn different_id_types_are_distinct_at_type_level() {
        let _n: NationId = NationId::new();
        let _p: ProvinceId = ProvinceId::new();
    }

    #[test]
    fn ids_serialize_as_uuid_strings() {
        let nid = NationId::new();
        let json = serde_json::to_string(&nid).unwrap();
        assert!(json.starts_with("\""));
        let back: NationId = serde_json::from_str(&json).unwrap();
        assert_eq!(nid, back);
    }
}
