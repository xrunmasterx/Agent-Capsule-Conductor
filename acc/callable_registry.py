from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from acc.models import (
    AccError,
    AgentClassTemplate,
    CallableRef,
    ClassTemplate,
    PermissionProfile,
    PortContract,
    ToolClassTemplate,
)


@dataclass(frozen=True)
class CallableAsset:
    template: ClassTemplate
    backend: str
    source_id: str
    source: Any | None = None
    source_path: Path | None = None


class CallableRegistry:
    """Class-template discovery boundary for runtime callable execution.

    Core v2 discovers callable class templates directly. Pre-Core-v2 YAML files
    are migration input only and must not seed runtime execution.
    """

    def __init__(
        self,
        assets: dict[tuple[str, str], CallableAsset],
        *,
        project_root: Path | None = None,
    ) -> None:
        self._assets = dict(assets)
        self.project_root = project_root.resolve() if project_root else None

    @classmethod
    def from_project_root(cls, project_root: Path) -> CallableRegistry:
        assets: dict[tuple[str, str], CallableAsset] = {}
        for kind, folder, parser in (
            ("agent_class", project_root / "callables" / "agents", _agent_template_from_yaml),
            ("tool_class", project_root / "callables" / "tools", _tool_template_from_yaml),
        ):
            if not folder.exists():
                continue
            for path in sorted([*folder.glob("*.yaml"), *folder.glob("*.yml")]):
                template = parser(path)
                key = (kind, template.id)
                if key in assets:
                    raise AccError(f"Duplicate callable class {kind}:{template.id}")
                assets[key] = CallableAsset(
                    template=template,
                    backend="native",
                    source_id=template.id,
                    source_path=path,
                )
        return cls(assets, project_root=project_root)

    def has(self, kind: str, callable_id: str) -> bool:
        return (kind, callable_id) in self._assets

    def iter_assets(self) -> tuple[CallableAsset, ...]:
        return tuple(self._assets[key] for key in sorted(self._assets))

    def resolve_class_id(self, class_id: str) -> CallableAsset:
        for kind in ("agent_class", "tool_class"):
            asset = self._assets.get((kind, class_id))
            if asset is not None:
                return asset
        raise AccError(f"Unknown callable class: {class_id}")

    def ref_keys(self) -> set[tuple[str, str]]:
        return set(self._assets)

    def workflow_ids(self) -> set[str]:
        ids: set[str] = set()
        for asset in self._assets.values():
            if asset.template.metadata.get("callable_wrapper") == "workflow_function":
                ids.add(asset.template.id)
        return ids

    def resolve(self, ref: CallableRef) -> CallableAsset:
        key = (ref.kind, ref.id)
        asset = self._assets.get(key)
        if asset is None:
            raise AccError(f"Unknown callable class: {ref.kind}:{ref.id}")
        return asset


def template_kind(template: ClassTemplate) -> str:
    if isinstance(template, AgentClassTemplate):
        return "agent_class"
    return "tool_class"


def _load_callable_yaml(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except FileNotFoundError as exc:
        raise AccError(f"Callable template not found: {path}") from exc
    except yaml.YAMLError as exc:
        raise AccError(f"Invalid callable template YAML: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise AccError(f"Callable template YAML must be an object: {path}")
    return payload


def _agent_template_from_yaml(path: Path) -> AgentClassTemplate:
    payload = _load_callable_yaml(path)
    callable_id = str(payload.get("id") or path.stem)
    runtime = str(payload.get("runtime") or payload.get("adapter") or "")
    if not runtime:
        raise AccError(f"Agent callable requires runtime: {path}")
    return AgentClassTemplate(
        id=callable_id,
        version=str(payload.get("version") or "0.1.0"),
        runtime=runtime,
        default_prompt=payload.get("default_prompt") or payload.get("prompt"),
        default_permissions=_permission_profile(
            payload.get("default_permissions") or payload.get("permissions"),
            path,
        ),
        input_ports=_port_contracts(payload.get("input_ports"), "input"),
        output_ports=_port_contracts(payload.get("output_ports"), "output"),
        artifact_contract=_dict_payload(
            payload.get("artifact_contract"), path, "artifact_contract"
        ),
        metadata=_metadata_payload(payload, path),
    )


def _tool_template_from_yaml(path: Path) -> ToolClassTemplate:
    payload = _load_callable_yaml(path)
    callable_id = str(payload.get("id") or path.stem)
    runner = str(payload.get("runner") or payload.get("adapter") or "")
    if not runner:
        raise AccError(f"Tool callable requires runner: {path}")
    return ToolClassTemplate(
        id=callable_id,
        version=str(payload.get("version") or "0.1.0"),
        runner=runner,
        default_permissions=_permission_profile(
            payload.get("default_permissions") or payload.get("permissions"),
            path,
        ),
        input_ports=_port_contracts(payload.get("input_ports"), "input"),
        output_ports=_port_contracts(payload.get("output_ports"), "output"),
        artifact_contract=_dict_payload(
            payload.get("artifact_contract"), path, "artifact_contract"
        ),
        metadata=_metadata_payload(payload, path),
    )


def _port_contracts(value: Any, direction: str) -> dict[str, PortContract]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AccError(f"Callable {direction}_ports must be an object")
    ports: dict[str, PortContract] = {}
    for port_id, raw_port in value.items():
        if not isinstance(port_id, str) or not isinstance(raw_port, dict):
            continue
        ports[port_id] = PortContract(
            id=str(raw_port.get("id") or port_id),
            direction=direction,  # type: ignore[arg-type]
            type=str(raw_port.get("type") or "artifact"),
            required=bool(raw_port.get("required", False)),
            cardinality=str(raw_port.get("cardinality") or "one"),
        )
    return ports


def _dict_payload(value: Any, path: Path, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AccError(f"Callable {field_name} must be an object: {path}")
    return dict(value)


def _permission_profile(value: Any, path: Path) -> PermissionProfile:
    if value is None:
        return PermissionProfile()
    if not isinstance(value, dict):
        raise AccError(f"Callable default_permissions must be an object: {path}")
    allowed_env = value.get("allowed_env") or ()
    if isinstance(allowed_env, str):
        allowed_env = (allowed_env,)
    if not isinstance(allowed_env, (list, tuple)):
        raise AccError(f"Callable default_permissions.allowed_env must be a list: {path}")
    return PermissionProfile(
        workspace_access=str(value.get("workspace_access") or "read_only"),  # type: ignore[arg-type]
        network=bool(value.get("network", False)),
        shell=bool(value.get("shell", False)),
        dangerous=bool(value.get("dangerous", False)),
        env_policy=str(value.get("env_policy") or "acc_whitelist"),  # type: ignore[arg-type]
        allowed_env=tuple(str(item) for item in allowed_env),
        timeout_seconds=int(value.get("timeout_seconds") or 60),
    )


def _metadata_payload(payload: dict[str, Any], path: Path) -> dict[str, Any]:
    metadata = payload.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise AccError(f"Callable metadata must be an object: {path}")
    merged = dict(metadata or {})
    merged["source_path"] = str(path)
    return merged
