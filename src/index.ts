/* eslint-disable import/order */
/* eslint-disable import/no-duplicates */
import { Scope } from './Scope.ts'
import { createG } from './lib/globals.ts'
import { operators } from './operators.ts'
import { Table } from './Table.ts'
import { LuaError } from './LuaError.ts'
import { libMath } from './lib/math.ts'
import { libTable } from './lib/table.ts'
import { libString, metatable as stringMetatable } from './lib/string.ts'
import { getLibOS } from './lib/os.ts'
import { getLibPackage } from './lib/package.ts'
import { LuaType, ensureArray, Config } from './utils.ts'
import { parse as parseScript } from './parser.ts'

interface Script {
    exec: () => LuaType
}

const call = async (f: Function | Table, ...args: LuaType[]): Promise<LuaType[]> => {
    if (f instanceof Function) return ensureArray(await Promise.resolve(f(...args)))

    const mm = f instanceof Table && f.getMetaMethod('__call')
    if (mm) return ensureArray(await Promise.resolve(mm(f, ...args)))

    throw new LuaError(`attempt to call an uncallable type`)
}

const stringTable = new Table()
stringTable.metatable = stringMetatable

const get = (t: Table | string, v: LuaType): LuaType => {
    if (t instanceof Table) return t.get(v)
    if (typeof t === 'string') return stringTable.get(v)

    throw new LuaError(`no table or metatable found for given type`)
}

const execChunk = (_G: Table, chunk: string, chunkName?: string): LuaType[] => {
    const exec = new Function('__lua', 'return (async () => {' + chunk + '})();')
    const globalScope = new Scope(_G.strValues).extend()
    if (chunkName) globalScope.setVarargs([chunkName])
    const res = exec({
        globalScope,
        ...operators,
        Table,
        call,
        get
    })
    return res === undefined ? [undefined] : res
}

function createEnv(
    config: Config = {}
): {
    parse: (script: string) => Script
    parseFile: (path: string) => Script
    loadLib: (name: string, value: Table) => void
} {
    const cfg: Config = {
        LUA_PATH: './?.lua',
        stdin: '',
        stdout: console.log,
        ...config
    }

    const _G = createG(cfg, execChunk)

    const { libPackage, _require } = getLibPackage(
        (content, moduleName) => execChunk(_G, parseScript(content), moduleName)[0],
        cfg
    )
    const loaded = libPackage.get('loaded') as Table

    const loadLib = (name: string, value: Table): void => {
        _G.rawset(name, value)
        loaded.rawset(name, value)
    }

    loadLib('_G', _G)
    loadLib('package', libPackage)
    loadLib('math', libMath)
    loadLib('table', libTable)
    loadLib('string', libString)
    loadLib('os', getLibOS(cfg))

    _G.rawset('require', _require)

    const parse = (code: string): Script => {
        const script = parseScript(code)
        return {
            exec: () => execChunk(_G, script)[0]
        }
    }

    const parseFile = (filename: string): Script => {
        if (!cfg.fileExists) throw new LuaError('parseFile requires the config.fileExists function')
        if (!cfg.loadFile) throw new LuaError('parseFile requires the config.loadFile function')

        if (!cfg.fileExists(filename)) throw new LuaError('file not found')

        return parse(cfg.loadFile(filename))
    }

    return {
        parse,
        parseFile,
        loadLib
    }
}

// eslint-disable-next-line import/first
import * as utils from './utils.ts'
export { createEnv, Table, LuaError, utils }
