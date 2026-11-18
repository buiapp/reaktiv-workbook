"""Typed native worksheet composition for executable format-2 Python workbooks."""
from __future__ import annotations

from typing import Any, Callable, Generic, Mapping, Self, TypeVar, cast, overload
from reaktiv import ReactiveModel
from .schema import sheet
from .narrowing import as_mapping

OwnerT = TypeVar('OwnerT', bound='Workbook')
SheetT = TypeVar('SheetT', bound='Worksheet[Any]')
WorkbookT = TypeVar('WorkbookT', bound=type['Workbook'])


class Worksheet(ReactiveModel, Generic[OwnerT]):
    workbook: OwnerT

    def _reaktiv_initialize_eager_members(self) -> None:
        if not getattr(self.workbook, '_worksheet_preparing', False):
            super()._reaktiv_initialize_eager_members()

    def start_members(self) -> None:
        super()._reaktiv_initialize_eager_members()


class WorksheetDeclaration(Generic[SheetT]):
    def __init__(self, model: type[SheetT], grid: Mapping[str, Any], layout: Mapping[str, Any]) -> None:
        self.model, self.grid, self.layout = model, dict(grid), dict(layout)
        self.name = ''

    def __set_name__(self, owner: type[Any], name: str) -> None:
        self.name = name

    @overload
    def __get__(self, instance: None, owner: type[Any] | None = None) -> WorksheetDeclaration[SheetT]: ...
    @overload
    def __get__(self, instance: Workbook, owner: type[Any] | None = None) -> SheetT: ...
    def __get__(self, instance: Workbook | None, owner: type[Any] | None = None) -> WorksheetDeclaration[SheetT] | SheetT:
        if instance is None:
            return self
        return instance.worksheet_instance(self.name)


def worksheet(model: type[SheetT], *, grid: Mapping[str, Any] | None = None, layout: Mapping[str, Any] | None = None) -> WorksheetDeclaration[SheetT]:
    return WorksheetDeclaration(model, grid or {'columns':10, 'rows':16}, layout or {})


class Workbook(ReactiveModel):
    def __init__(self, **fields: object) -> None:
        self._worksheet_preparing = True
        self._worksheet_instances: dict[str, Worksheet[Any]] = {}
        declarations = worksheet_declarations(type(self))
        # Every namespace exists before any resource/effect is allowed to read another.
        for name, declaration in declarations:
            instance = object.__new__(declaration.model)
            instance.workbook = self
            self._worksheet_instances[name] = instance
        for name, instance in self._worksheet_instances.items():
            initial = as_mapping(fields.pop(name, {}))
            if initial is None:
                raise TypeError(f'Worksheet {name} initial values must be a mapping')
            instance.__init__(**initial)
        super().__init__(**fields)
        self._worksheet_preparing = False
        for instance in self._worksheet_instances.values():
            instance.start_members()

    @property
    def workbook(self) -> Self:
        """This workbook, so actions can use the same `self.workbook.Sheet.member` as cells."""
        return self

    def worksheet_names(self) -> tuple[str, ...]:
        return tuple(self._worksheet_instances)

    def worksheet_instance(self, name: str) -> Any:
        return self._worksheet_instances[name]

    def dispose(self) -> None:
        for instance in self._worksheet_instances.values():
            instance.dispose()
        super().dispose()


def workbook_config(config: Mapping[str, Any]) -> Callable[[WorkbookT], WorkbookT]:
    """Workbook metadata (name, environment, note order, …) for a format-2 workbook class."""
    def decorate(model: WorkbookT) -> WorkbookT:
        if config.get('formatVersion') != 2:
            raise ValueError('@workbook_config requires formatVersion=2')
        declarations = worksheet_declarations(model)
        if not declarations:
            raise ValueError('A workbook must declare at least one worksheet')
        name, first = declarations[0]
        settings = {**config, 'sheetName':name, 'grid':first.grid, 'layout':{**first.layout, **dict(config.get('layout', {}))}, 'sheets':[{'name':name, 'grid':item.grid, 'layout':item.layout} for name, item in declarations[1:]]}
        sheet(settings)(model)
        return model
    return decorate


# The decorator's name in files written before it was renamed (imported from this module,
# because `reaktiv_workbook.workbook` is a module).
workbook = workbook_config


def worksheet_declarations(model: type[Any]) -> list[tuple[str, WorksheetDeclaration[Any]]]:
    return [(name, cast(WorksheetDeclaration[Any], value)) for name, value in vars(model).items() if isinstance(value, WorksheetDeclaration)]
