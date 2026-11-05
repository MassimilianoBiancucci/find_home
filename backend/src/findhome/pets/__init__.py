"""Pet policy of a listing: strict wording rules per language (config/pet_rules.yaml) and the precedence of who
decides (user > agent > site > keywords). See guide/architecture/config_and_locations.md (Pets)."""
from findhome.pets.apply import RANK, apply_pet, ingest_candidate
from findhome.pets.detect import PetFinding, detect

__all__ = ["RANK", "PetFinding", "apply_pet", "detect", "ingest_candidate"]
