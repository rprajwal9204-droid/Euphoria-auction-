import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, supabaseConfigured } from './lib/supabase'
import './styles.css'

const TEAM_COLORS = {
  Falcons: 'blue',
  Eagles: 'yellow',
  Thunderbirds: 'purple',
  Griffins: 'red',
  Phoenix: 'orange'
}

const TEAM_NAMES = Object.keys(TEAM_COLORS)

function App() {
  const [mode, setMode] = useState('public')
  const [page, setPage] = useState('auction')

  const [pool, setPool] = useState(null)
  const [pools, setPools] = useState([])
  const [teams, setTeams] = useState([])

  const [balances, setBalances] = useState([])
  const [current, setCurrent] = useState(null)

  const [players, setPlayers] = useState([])
  const [history, setHistory] = useState([])
  const [allHistory, setAllHistory] = useState([])
  const [bids, setBids] = useState([])

  const [selectedTeam, setSelectedTeam] = useState(null)

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loginOpen, setLoginOpen] = useState(false)
  const [toast, setToast] = useState('')

  const [rollOpen, setRollOpen] = useState(false)
  const [rollNumber, setRollNumber] = useState('')
  const [startingPlayer, setStartingPlayer] = useState(false)

  const [deletingBid, setDeletingBid] = useState(null)
  const [undoingSale, setUndoingSale] = useState(null)
  const [deletingPlayer, setDeletingPlayer] = useState(null)

  const [importingPlayers, setImportingPlayers] = useState(false)

  const fileInputRef = useRef(null)

  const teamMap = useMemo(
    () => Object.fromEntries(teams.map(t => [t.name, t])),
    [teams]
  )

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
      }
    )

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    loadBase()
  }, [])

  useEffect(() => {
    if (!pool || !supabaseConfigured) return

    loadPool()

    const channel = supabase
      .channel(`auction-${pool.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_states',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'players',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bids',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'team_pool_balances',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_results',
          filter: `pool_id=eq.${pool.id}`
        },
        loadPool
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [pool?.id])

  async function loadBase() {
    if (!supabaseConfigured) return

    const [p, t, results] = await Promise.all([
      supabase
        .from('pools')
        .select('*')
        .order('batch_year')
        .order('gender'),

      supabase
        .from('teams')
        .select('*')
        .order('sort_order'),

      supabase
        .from('auction_results')
        .select('*, player:players(*), team:teams(*), pool:pools(*)')
        .order('created_at', { ascending: false })
    ])

    if (p.error) notify(p.error.message)
    if (t.error) notify(t.error.message)
    if (results.error) notify(results.error.message)

    setPools(p.data || [])
    setTeams(t.data || [])
    setAllHistory(results.data || [])

    if (p.data?.length) {
      setPool(
        prev =>
          prev ||
          p.data.find(
            x =>
              x.batch_year === 2024 &&
              x.gender === 'Male'
          ) ||
          p.data[0]
      )
    }

    setLoading(false)
  }

  async function loadPool() {
    if (!pool) return

    const [state, bal, ps, hist, bidData] = await Promise.all([
      supabase
        .from('auction_states')
        .select('*, current_player:players(*)')
        .eq('pool_id', pool.id)
        .single(),

      supabase
        .from('team_pool_balances')
        .select('*, team:teams(*)')
        .eq('pool_id', pool.id)
        .order('id'),

      supabase
        .from('players')
        .select('*')
        .eq('pool_id', pool.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('auction_results')
        .select('*, player:players(*), team:teams(*)')
        .eq('pool_id', pool.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('bids')
        .select('*, team:teams(*)')
        .eq('pool_id', pool.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    ])

    if (state.error && state.error.code !== 'PGRST116') {
      notify(state.error.message)
    }

    if (bal.error) notify(bal.error.message)
    if (ps.error) notify(ps.error.message)
    if (hist.error) notify(hist.error.message)
    if (bidData.error) notify(bidData.error.message)

    setCurrent(state.data || null)
    setBalances(bal.data || [])
    setPlayers(ps.data || [])
    setHistory(hist.data || [])
    setBids(bidData.data || [])

    const { data: completeHistory } = await supabase
      .from('auction_results')
      .select('*, player:players(*), team:teams(*), pool:pools(*)')
      .order('created_at', { ascending: false })

    setAllHistory(completeHistory || [])
  }

  function notify(msg) {
    setToast(msg)

    setTimeout(() => {
      setToast('')
    }, 3500)
  }

  async function login(email, password) {
    if (!supabase) return

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      })

    if (error) {
      notify(error.message)
    } else {
      setLoginOpen(false)
      setMode('admin')
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    setMode('public')
  }

  /*
   * =========================================================
   * CSV IMPORT
   * =========================================================
   *
   * Expected Google Sheet columns:
   *
   * Roll Number | Name
   *
   * Also accepts:
   *
   * roll_number | name
   * roll | name
   * Roll No | Player Name
   *
   * The import is always tied to the CURRENT selected pool.
   */

  function cleanCsvValue(value) {
    if (value === null || value === undefined) {
      return ''
    }

    return String(value)
      .replace(/^\uFEFF/, '')
      .trim()
  }

  function parseCSV(text) {
    const rows = []
    let row = []
    let value = ''
    let insideQuotes = false

    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      const next = text[i + 1]

      if (char === '"') {
        if (insideQuotes && next === '"') {
          value += '"'
          i++
        } else {
          insideQuotes = !insideQuotes
        }
      } else if (char === ',' && !insideQuotes) {
        row.push(value)
        value = ''
      } else if (
        (char === '\n' || char === '\r') &&
        !insideQuotes
      ) {
        if (char === '\r' && next === '\n') {
          i++
        }

        row.push(value)
        value = ''

        if (row.some(cell => cleanCsvValue(cell) !== '')) {
          rows.push(row)
        }

        row = []
      } else {
        value += char
      }
    }

    if (value !== '' || row.length > 0) {
      row.push(value)

      if (row.some(cell => cleanCsvValue(cell) !== '')) {
        rows.push(row)
      }
    }

    return rows
  }

  function normaliseHeader(header) {
    return cleanCsvValue(header)
      .toLowerCase()
      .replace(/[\s_-]+/g, '')
  }

  function findColumn(headers, possibleNames) {
    for (const name of possibleNames) {
      const index = headers.findIndex(
        h => normaliseHeader(h) === normaliseHeader(name)
      )

      if (index !== -1) {
        return index
      }
    }

    return -1
  }

  async function handlePlayerCSV(event) {
    const file = event.target.files?.[0]

    if (!file) return

    if (!session) {
      setLoginOpen(true)
      event.target.value = ''
      return
    }

    if (!pool) {
      notify('Select a pool first')
      event.target.value = ''
      return
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      notify('Please export your Google Sheet as CSV first')
      event.target.value = ''
      return
    }

    setImportingPlayers(true)

    try {
      const text = await file.text()
      const rows = parseCSV(text)

      if (!rows.length) {
        throw new Error('The CSV file is empty')
      }

      const headers = rows[0]

      const rollIndex = findColumn(headers, [
        'roll_number',
        'roll number',
        'roll no',
        'rollno',
        'roll',
        'roll_number.'
      ])

      const nameIndex = findColumn(headers, [
        'name',
        'player name',
        'player_name',
        'playername'
      ])

      if (rollIndex === -1) {
        throw new Error(
          'Could not find Roll Number column'
        )
      }

      if (nameIndex === -1) {
        throw new Error(
          'Could not find Name column'
        )
      }

      const imported = []
      const seenRolls = new Set()

      let duplicateRows = 0
      let emptyRows = 0

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]

        const roll = cleanCsvValue(row[rollIndex])
        const name = cleanCsvValue(row[nameIndex])

        if (!roll || !name) {
          emptyRows++
          continue
        }

        /*
         * Duplicate protection INSIDE the CSV itself.
         *
         * If Google Sheet accidentally contains:
         *
         * 101 John
         * 101 John
         *
         * only one is sent to Supabase.
         */
        const rollKey = roll.toLowerCase()

        if (seenRolls.has(rollKey)) {
          duplicateRows++
          continue
        }

        seenRolls.add(rollKey)

        imported.push({
          roll_number: roll,
          name
        })
      }

      if (!imported.length) {
        throw new Error(
          'No valid players were found in the CSV'
        )
      }

      /*
       * Send the complete list to the secure Supabase RPC.
       *
       * The database function:
       *
       * - checks admin access
       * - checks pool
       * - finds existing roll numbers
       * - updates existing unsold players
       * - keeps SOLD players safe
       * - inserts genuinely new players
       */
      const { data, error } = await supabase.rpc(
        'import_players',
        {
          p_pool_id: pool.id,
          p_players: imported
        }
      )

      if (error) {
        throw new Error(error.message)
      }

      await loadPool()

      const added = Number(data || 0)

      notify(
        `Import complete • ${added} new player${
          added === 1 ? '' : 's'
        } added`
      )

      if (duplicateRows > 0 || emptyRows > 0) {
        setTimeout(() => {
          notify(
            `${duplicateRows} duplicate row${
              duplicateRows === 1 ? '' : 's'
            } skipped • ${emptyRows} empty row${
              emptyRows === 1 ? '' : 's'
            } skipped`
          )
        }, 3800)
      }
    } catch (error) {
      notify(
        error?.message ||
          'Player import failed'
      )
    } finally {
      setImportingPlayers(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function openImportPicker() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!pool) {
      notify('Select a pool first')
      return
    }

    fileInputRef.current?.click()
  }

  async function startPlayerByRoll() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const roll = rollNumber.trim()

    if (!roll) {
      notify('Enter a roll number')
      return
    }

    if (!pool) {
      notify('Select a pool first')
      return
    }

    if (current?.current_player_id) {
      notify('Finish the current player first')
      return
    }

    setStartingPlayer(true)

    const { error } = await supabase.rpc(
      'start_player_by_roll',
      {
        p_pool_id: pool.id,
        p_roll_number: roll
      }
    )

    setStartingPlayer(false)

    if (error) {
      notify(error.message)
      return
    }

    setRollNumber('')
    setRollOpen(false)

    notify(`Player ${roll} entered auction`)
    await loadPool()
  }

  /*
   * =========================================================
   * BIDDING
   * =========================================================
   */

  async function bid(teamName) {
    const team = teamMap[teamName]

    if (!team || !current?.current_player_id) {
      return
    }

    const playerBids = bids.filter(
      b =>
        b.player_id ===
        current.current_player_id
    )

    const amount =
      playerBids.length === 0
        ? 3
        : nextBid(current.current_bid)

    const { error } = await supabase.rpc(
      'manual_bid',
      {
        p_pool_id: pool.id,
        p_team_id: team.id,
        p_amount: amount
      }
    )

    if (error) {
      notify(error.message)
    } else {
      await loadPool()
    }
  }

  async function sold() {
    if (!current?.leader_team_id) {
      notify('Player has no winning team')
      return
    }

    const { error } =
      await supabase.rpc(
        'sell_current_player',
        {
          p_pool_id: pool.id
        }
      )

    if (error) {
      notify(error.message)
    } else {
      notify('Player SOLD')
      await loadPool()
    }
  }

  async function unsold() {
    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const { error } =
      await supabase.rpc(
        'mark_unsold',
        {
          p_pool_id: pool.id
        }
      )

    if (error) {
      notify(error.message)
    } else {
      notify(
        'Player UNSOLD • You can enter the same roll number again'
      )
      await loadPool()
    }
  }

  async function deleteBid(id) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (
      !window.confirm(
        'Delete this bid?\n\nOnly this bid will be removed.'
      )
    ) {
      return
    }

    setDeletingBid(id)

    const { error } =
      await supabase.rpc(
        'delete_bid',
        {
          p_bid_id: id
        }
      )

    setDeletingBid(null)

    if (error) {
      notify(error.message)
    } else {
      notify('Bid deleted')
      await loadPool()
    }
  }

  async function undoLastBid() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!current?.current_player_id) {
      notify('No live player')
      return
    }

    const playerBids = bids
      .filter(
        b =>
          b.player_id ===
          current.current_player_id
      )
      .sort((a, b) => {
        const difference =
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()

        if (difference !== 0) {
          return difference
        }

        return Number(a.id) - Number(b.id)
      })

    const lastBid =
      playerBids[playerBids.length - 1]

    if (!lastBid) {
      notify('There are no bids to undo')
      return
    }

    await deleteBid(lastBid.id)
  }

  async function undoSoldPlayer(resultId) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const result =
      history.find(x => x.id === resultId)

    if (!result || result.status !== 'SOLD') {
      notify('Only SOLD players can be undone')
      return
    }

    if (
      !window.confirm(
        `Undo the sale of ${
          result.player?.name || 'this player'
        }?\n\n` +
        `Team: ${
          result.team?.name || 'Unknown'
        }\n` +
        `Refund: ${result.final_price} EP\n\n` +
        `The player will be removed from the squad and returned to available status.`
      )
    ) {
      return
    }

    setUndoingSale(resultId)

    const { error } =
      await supabase.rpc(
        'undo_sold_player',
        {
          p_result_id: resultId
        }
      )

    setUndoingSale(null)

    if (error) {
      notify(error.message)
    } else {
      notify(
        `Sale undone • ${result.final_price} EP refunded`
      )
      await loadPool()
    }
  }

  async function deletePlayer(playerId) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const player =
      players.find(p => p.id === playerId)

    if (!player) return

    if (player.status === 'sold') {
      notify(
        'Sold players cannot be deleted. Undo the sale first.'
      )
      return
    }

    if (
      !window.confirm(
        `Delete ${player.name} (${player.roll_number})?\n\nThis permanently removes the player from this pool.`
      )
    ) {
      return
    }

    setDeletingPlayer(playerId)

    const { error } =
      await supabase.rpc(
        'delete_player',
        {
          p_player_id: playerId
        }
      )

    setDeletingPlayer(null)

    if (error) {
      notify(error.message)
    } else {
      notify('Player deleted')
      await loadPool()
    }
  }

  const selectedBalance = name =>
    balances.find(
      x =>
        x.team_id ===
        teamMap[name]?.id
    )?.remaining_ep ?? 150

  const nextBid = b => {
    const value = Number(b)

    if (!Number.isFinite(value)) {
      return 3
    }

    if (value < 10) {
      return value + 1
    }

    if (value < 20) {
      return value + 2
    }

    return value + 5
  }

  const currentPlayerBids =
    current?.current_player_id
      ? bids
          .filter(
            b =>
              b.player_id ===
              current.current_player_id
          )
          .sort((a, b) => {
            const difference =
              new Date(
                a.created_at
              ).getTime() -
              new Date(
                b.created_at
              ).getTime()

            if (difference !== 0) {
              return difference
            }

            return (
              Number(a.id) -
              Number(b.id)
            )
          })
      : []

  const displayedBidAmount =
    currentPlayerBids.length === 0
      ? 3
      : nextBid(
          current?.current_bid
        )

  function currentPoolTeamPlayers(teamName) {
    if (!pool) return []

    return history.filter(
      x =>
        x.status === 'SOLD' &&
        x.team?.name === teamName
    )
  }

  function allPoolTeamPlayers(teamName) {
    return allHistory.filter(
      x =>
        x.status === 'SOLD' &&
        x.team?.name === teamName
    )
  }

  function openCurrentPoolTeam(teamName) {
    setSelectedTeam(teamName)
    setPage('teams')
  }

  function openAllPoolsTeam(teamName) {
    setSelectedTeam(teamName)
    setPage('teams')
  }

  function auction() {
    const c = current

    return (
      <>
        <div className="sectionhead">
          <div>
            <div className="eyebrow">
              {poolLabel(pool)} POOL
            </div>

            <div className="title">
              LIVE AUCTION
            </div>

            <div className="sub">
              No timer • Admin-controlled
              bidding • Real-time Supabase sync
            </div>
          </div>

          <select
            className="select"
            value={pool?.id || ''}
            onChange={e => {
              setSelectedTeam(null)

              setPool(
                pools.find(
                  x =>
                    x.id ===
                    e.target.value
                )
              )
            }}
          >
            {pools.map(p => (
              <option
                key={p.id}
                value={p.id}
              >
                {poolLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid">
          <section>
            <div className="card player">
              <div className="roll">
                ROLL NO.{' '}
                {c?.current_player
                  ?.roll_number || '—'}
              </div>

              <div className="playername">
                {c?.current_player?.name ||
                  'No Player Added'}
              </div>

              <div className="ep">
                CURRENT BID
              </div>

              <div className="bid">
                {c?.current_bid ?? 3}
                <small> EP</small>
              </div>

              <div
                className={`leader ${
                  TEAM_COLORS[
                    c?.leader_team?.name
                  ] || ''
                }`}
              >
                {c?.leader_team?.name
                  ? `${c.leader_team.name} • ${c.current_bid} EP`
                  : 'OPEN • BASE 3 EP'}
              </div>
            </div>

            {mode === 'admin' && (
              <>
                <div className="controls">
                  {TEAM_NAMES.map(name => (
                    <button
                      className="teamBtn"
                      key={name}
                      disabled={
                        !c?.current_player ||
                        selectedBalance(name) <
                          displayedBidAmount
                      }
                      onClick={() =>
                        bid(name)
                      }
                    >
                      <span
                        className={
                          TEAM_COLORS[name]
                        }
                      >
                        {name}
                      </span>

                      <small>
                        Bid{' '}
                        {displayedBidAmount}{' '}
                        EP
                      </small>
                    </button>
                  ))}
                </div>

                <div className="actions">
                  <button
                    className="success"
                    onClick={sold}
                    disabled={
                      !c?.current_player ||
                      !c?.leader_team_id
                    }
                  >
                    ✓ SOLD
                  </button>

                  <button
                    className="danger"
                    onClick={unsold}
                    disabled={
                      !c?.current_player
                    }
                  >
                    UNSOLD
                  </button>

                  <button
                    className="primary"
                    onClick={() =>
                      setRollOpen(true)
                    }
                    disabled={
                      !!c?.current_player
                    }
                  >
                    NEXT PLAYER
                  </button>
                </div>

                {rollOpen && (
                  <div
                    className="card"
                    style={{
                      marginTop: '16px'
                    }}
                  >
                    <div className="eyebrow">
                      NEXT PLAYER
                    </div>

                    <div className="teamPool">
                      {poolLabel(pool)}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '10px',
                        marginTop: '12px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <input
                        className="field"
                        style={{
                          flex: '1',
                          minWidth: '180px'
                        }}
                        autoFocus
                        inputMode="numeric"
                        placeholder="Enter roll number"
                        value={rollNumber}
                        onChange={e =>
                          setRollNumber(
                            e.target.value
                          )
                        }
                        onKeyDown={e => {
                          if (
                            e.key ===
                            'Enter'
                          ) {
                            startPlayerByRoll()
                          }
                        }}
                      />

                      <button
                        className="btn primary"
                        disabled={
                          startingPlayer ||
                          !rollNumber.trim()
                        }
                        onClick={
                          startPlayerByRoll
                        }
                      >
                        {startingPlayer
                          ? 'Entering…'
                          : 'ENTER PLAYER'}
                      </button>

                      <button
                        className="btn"
                        onClick={() => {
                          setRollOpen(false)
                          setRollNumber('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>

                    <div
                      className="notice"
                      style={{
                        marginTop: '12px'
                      }}
                    >
                      Type the roll number of
                      any available or UNSOLD
                      player. A SOLD player
                      cannot be entered again.
                    </div>
                  </div>
                )}

                {c?.current_player && (
                  <div
                    className="card"
                    style={{
                      marginTop: '16px'
                    }}
                  >
                    <div className="eyebrow">
                      ADMIN BID CONTROL
                    </div>

                    <div className="teamPool">
                      {c.current_player.name}
                      {' • '}
                      Bid History
                    </div>

                    {currentPlayerBids.length ===
                    0 ? (
                      <div className="notice">
                        No bids yet. Player
                        is open at <b>3 EP</b>.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection:
                              'column',
                            gap: '8px',
                            marginTop:
                              '12px'
                          }}
                        >
                          {currentPlayerBids.map(
                            b => (
                              <div
                                key={b.id}
                                style={{
                                  display:
                                    'flex',
                                  justifyContent:
                                    'space-between',
                                  alignItems:
                                    'center',
                                  gap: '10px',
                                  padding:
                                    '10px 12px',
                                  border:
                                    '1px solid rgba(255,255,255,.1)',
                                  borderRadius:
                                    '10px'
                                }}
                              >
                                <div>
                                  <strong>
                                    {b.team
                                      ?.name ||
                                      'Unknown Team'}
                                  </strong>

                                  <div
                                    className="sub"
                                    style={{
                                      marginTop:
                                        '2px'
                                    }}
                                  >
                                    {b.amount} EP
                                  </div>
                                </div>

                                <button
                                  className="danger"
                                  disabled={
                                    deletingBid ===
                                    b.id
                                  }
                                  onClick={() =>
                                    deleteBid(
                                      b.id
                                    )
                                  }
                                >
                                  {deletingBid ===
                                  b.id
                                    ? 'Deleting…'
                                    : '🗑 Delete'}
                                </button>
                              </div>
                            )
                          )}
                        </div>

                        <div
                          className="actions"
                          style={{
                            marginTop:
                              '12px'
                          }}
                        >
                          <button
                            className="danger"
                            onClick={
                              undoLastBid
                            }
                            disabled={
                              currentPlayerBids.length ===
                                0 ||
                              deletingBid !==
                                null
                            }
                          >
                            ↩ Undo Last Bid
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <div className="card">
              <div className="eyebrow">
                TEAM BALANCES
              </div>

              <div className="teamPool">
                {poolLabel(pool)}
              </div>

              <div className="teams">
                {TEAM_NAMES.map(name => (
                  <TeamCard
                    key={name}
                    name={name}
                    balance={selectedBalance(
                      name
                    )}
                    onClick={() =>
                      openCurrentPoolTeam(
                        name
                      )
                    }
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </>
    )
  }

  function teamsPage() {
    if (selectedTeam) {
      const currentPoolPlayers =
        currentPoolTeamPlayers(
          selectedTeam
        )

      const allPlayers =
        allPoolTeamPlayers(
          selectedTeam
        )

      return (
        <TeamDetails
          selectedTeam={selectedTeam}
          pool={pool}
          currentPoolPlayers={
            currentPoolPlayers
          }
          allPlayers={allPlayers}
          onBack={() =>
            setSelectedTeam(null)
          }
        />
      )
    }

    return (
      <>
        <Header
          eyebrow="5 TEAMS"
          title="TEAMS"
          sub="Select a team to view its complete squad across all pools."
        />

        <div className="stats">
          {TEAM_NAMES.map(name => {
            const count =
              allPoolTeamPlayers(
                name
              ).length

            return (
              <button
                key={name}
                className="stat"
                onClick={() =>
                  openAllPoolsTeam(
                    name
                  )
                }
                style={{
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <span
                  className={
                    TEAM_COLORS[name]
                  }
                >
                  {name}
                </span>

                <b>
                  {count} player
                  {count === 1
                    ? ''
                    : 's'}
                </b>

                <small>
                  View all pools →
                </small>
              </button>
            )
          })}
        </div>
      </>
    )
  }

  function playersPage() {
    return (
      <>
        <div className="sectionhead">
          <div>
            <div className="eyebrow">
              PLAYERS
            </div>

            <div className="title">
              PLAYERS
            </div>

            <div className="sub">
              Players in {poolLabel(pool)}
            </div>
          </div>

          {mode === 'admin' && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap'
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={
                  handlePlayerCSV
                }
              />

              <button
                className="btn primary"
                onClick={openImportPicker}
                disabled={importingPlayers}
              >
                {importingPlayers
                  ? 'Importing…'
                  : '📥 IMPORT PLAYERS'}
              </button>
            </div>
          )}
        </div>

        <div className="card">
          {mode === 'admin' && (
            <div
              className="notice"
              style={{
                marginBottom: '16px'
              }}
            >
              <b>Google Sheets import</b>
              <br />

              Export your Google Sheet as{' '}
              <b>CSV</b> and upload it here.
              <br />

              Required columns:{' '}
              <b>Roll Number</b> and{' '}
              <b>Name</b>.
              <br />

              <span
                style={{
                  opacity: 0.8
                }}
              >
                Re-importing a list containing
                old + new players will not
                create duplicate players.
              </span>
            </div>
          )}

          <div className="notice">
            The selected pool is{' '}
            <b>{poolLabel(pool)}</b>.
            Players from other batch/gender
            pools are not shown here.
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Roll</th>
                <th>Name</th>
                <th>Status</th>

                {mode === 'admin' && (
                  <th>Action</th>
                )}
              </tr>
            </thead>

            <tbody>
              {players.map(p => (
                <tr key={p.id}>
                  <td>
                    {p.roll_number}
                  </td>

                  <td>
                    {p.name}
                  </td>

                  <td>
                    {p.status}
                  </td>

                  {mode === 'admin' && (
                    <td>
                      <button
                        className="danger"
                        disabled={
                          deletingPlayer ===
                            p.id ||
                          p.status === 'sold'
                        }
                        onClick={() =>
                          deletePlayer(
                            p.id
                          )
                        }
                      >
                        {p.status === 'sold'
                          ? 'Sold'
                          : deletingPlayer ===
                            p.id
                          ? 'Deleting…'
                          : '🗑 Delete'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {players.length === 0 && (
            <div className="notice">
              No players have been added to
              this pool yet.
            </div>
          )}
        </div>
      </>
    )
  }

  function historyPage() {
    return (
      <>
        <Header
          eyebrow="COMPLETE LIST"
          title="AUCTION HISTORY"
          sub={`Auction history for ${poolLabel(pool)}.`}
        />

        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Result</th>
                <th>Team</th>
                <th>Price</th>

                {mode === 'admin' && (
                  <th>Action</th>
                )}
              </tr>
            </thead>

            <tbody>
              {history.map(x => (
                <tr key={x.id}>
                  <td>
                    {x.player
                      ?.roll_number}{' '}
                    —{' '}
                    {x.player?.name}
                  </td>

                  <td>
                    {x.status}
                  </td>

                  <td>
                    {x.team?.name ||
                      '—'}
                  </td>

                  <td>
                    {x.final_price
                      ? `${x.final_price} EP`
                      : '—'}
                  </td>

                  {mode === 'admin' && (
                    <td>
                      {x.status ===
                        'SOLD' && (
                        <button
                          className="danger"
                          disabled={
                            undoingSale ===
                            x.id
                          }
                          onClick={() =>
                            undoSoldPlayer(
                              x.id
                            )
                          }
                        >
                          {undoingSale ===
                          x.id
                            ? 'Undoing…'
                            : '↩ Undo Sale'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  function poolsPage() {
    return (
      <>
        <Header
          eyebrow="10 INDEPENDENT POOLS"
          title="POOLS"
          sub="Each team starts with 150 EP in every pool."
        />

        <div className="stats poolsGrid">
          {pools.map(p => (
            <div
              className="stat"
              key={p.id}
            >
              <span>
                {poolLabel(p)}
              </span>

              <b>5 × 150 EP</b>

              <small>
                Independent team
                budgets
              </small>
            </div>
          ))}
        </div>
      </>
    )
  }

  if (loading) {
    return (
      <div className="loading">
        Loading Euphoria…
      </div>
    )
  }

  if (!supabaseConfigured) {
    return <SetupScreen />
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          EUPHORIA
          <span> AUCTION</span>
        </div>

        <div className="topright">
          <div className="pill">
            {mode.toUpperCase()} VIEW
          </div>

          {session ? (
            <button
              className="btn"
              onClick={() =>
                mode === 'admin'
                  ? logout()
                  : setMode('admin')
              }
            >
              {mode === 'admin'
                ? 'Logout'
                : 'Admin'}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() =>
                setLoginOpen(true)
              }
            >
              Admin
            </button>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="side">
          <div className="nav">
            <Nav
              active={
                page === 'auction'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('auction')
              }}
            >
              🔴 Live Auction
            </Nav>

            <Nav
              active={
                page === 'players'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('players')
              }}
            >
              👤 Players
            </Nav>

            <Nav
              active={
                page === 'teams'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('teams')
              }}
            >
              🏆 Teams
            </Nav>

            <Nav
              active={
                page === 'history'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('history')
              }}
            >
              📜 Auction History
            </Nav>

            <Nav
              active={
                page === 'pools'
              }
              onClick={() => {
                setSelectedTeam(null)
                setPage('pools')
              }}
            >
              🗂 Pools
            </Nav>
          </div>
        </aside>

        <main className="content">
          {page === 'auction'
            ? auction()
            : page === 'players'
            ? playersPage()
            : page === 'teams'
            ? teamsPage()
            : page === 'history'
            ? historyPage()
            : poolsPage()}
        </main>
      </div>

      {loginOpen && (
        <Login
          onLogin={login}
          onClose={() =>
            setLoginOpen(false)
          }
        />
      )}

      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}
    </div>
  )
}

function TeamDetails({
  selectedTeam,
  pool,
  currentPoolPlayers,
  allPlayers,
  onBack
}) {
  const [viewMode, setViewMode] =
    useState('all')

  const displayedPlayers =
    viewMode === 'current'
      ? currentPoolPlayers
      : allPlayers

  return (
    <>
      <div className="sectionhead">
        <div>
          <div className="eyebrow">
            TEAM SQUAD
          </div>

          <div className="title">
            {selectedTeam}
          </div>

          <div className="sub">
            {viewMode === 'current'
              ? `Players from ${poolLabel(
                  pool
                )}`
              : 'Players from all pools'}
          </div>
        </div>

        <button
          className="btn"
          onClick={onBack}
        >
          ← All Teams
        </button>
      </div>

      <div
        className="actions"
        style={{
          marginBottom: '16px'
        }}
      >
        <button
          className={
            viewMode === 'current'
              ? 'btn primary'
              : 'btn'
          }
          onClick={() =>
            setViewMode('current')
          }
        >
          Current Pool
        </button>

        <button
          className={
            viewMode === 'all'
              ? 'btn primary'
              : 'btn'
          }
          onClick={() =>
            setViewMode('all')
          }
        >
          All Pools
        </button>
      </div>

      <div className="card">
        <div className="eyebrow">
          {selectedTeam} •{' '}
          {viewMode === 'current'
            ? poolLabel(pool)
            : 'ALL POOLS'}
        </div>

        <div
          className="teamPool"
          style={{
            marginBottom: '12px'
          }}
        >
          {displayedPlayers.length}{' '}
          player
          {displayedPlayers.length ===
          1
            ? ''
            : 's'}
        </div>

        {displayedPlayers.length ===
        0 ? (
          <div className="notice">
            No players purchased by{' '}
            {selectedTeam}{' '}
            {viewMode === 'current'
              ? `in ${poolLabel(pool)}`
              : 'across any pool'}.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                {viewMode ===
                  'all' && (
                  <th>Pool</th>
                )}

                <th>Player</th>
                <th>Price</th>
              </tr>
            </thead>

            <tbody>
              {displayedPlayers.map(
                x => (
                  <tr key={x.id}>
                    {viewMode ===
                      'all' && (
                      <td>
                        {x.pool
                          ? `${x.pool.batch_year} • ${x.pool.gender}`
                          : '—'}
                      </td>
                    )}

                    <td>
                      {x.player
                        ?.roll_number}{' '}
                      —{' '}
                      {x.player?.name}
                    </td>

                    <td>
                      {x.final_price} EP
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function TeamCard({
  name,
  balance,
  onClick
}) {
  return (
    <div
      className="team"
      onClick={onClick}
      style={{
        cursor: 'pointer'
      }}
    >
      <div className="teamtop">
        <span
          className={`teamname ${
            TEAM_COLORS[name]
          }`}
        >
          {name}
        </span>

        <span className="balance">
          {balance} EP
        </span>
      </div>

      <div
        className={`bar ${
          TEAM_COLORS[name]
        }`}
      >
        <i
          style={{
            width: `${Math.max(
              0,
              Math.min(
                100,
                (balance / 150) *
                  100
              )
            )}%`
          }}
        />
      </div>

      <small
        style={{
          display: 'block',
          marginTop: '6px',
          opacity: 0.7
        }}
      >
        Tap to view players →
      </small>
    </div>
  )
}

function Header({
  eyebrow,
  title,
  sub
}) {
  return (
    <div className="sectionhead">
      <div>
        <div className="eyebrow">
          {eyebrow}
        </div>

        <div className="title">
          {title}
        </div>

        <div className="sub">
          {sub}
        </div>
      </div>
    </div>
  )
}

function Nav({
  active,
  onClick,
  children
}) {
  return (
    <button
      className={
        active ? 'active' : ''
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function poolLabel(p) {
  return p
    ? `${p.batch_year} • ${p.gender}`
    : '—'
}

function Login({
  onLogin,
  onClose
}) {
  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  return (
    <div className="modal">
      <div className="modalCard">
        <div className="title">
          Admin Login
        </div>

        <div className="sub">
          Only authenticated admins
          can run the auction.
        </div>

        <input
          className="field"
          placeholder="Admin email"
          value={email}
          onChange={e =>
            setEmail(
              e.target.value
            )
          }
        />

        <input
          className="field"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e =>
            setPassword(
              e.target.value
            )
          }
        />

        <div className="actions">
          <button
            className="btn"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="btn primary"
            onClick={() =>
              onLogin(
                email,
                password
              )
            }
          >
            Login
          </button>
        </div>
      </div>
    </div>
  )
}

function SetupScreen() {
  return (
    <div className="loading">
      <div className="card setup">
        <div className="title">
          Euphoria is ready for
          Supabase
        </div>

        <p className="sub">
          Add
          VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY
          to your Vercel environment
          variables, run the supplied
          SQL in Supabase, then
          redeploy.
        </p>
      </div>
    </div>
  )
}

createRoot(
  document.getElementById('root')
).render(<App />)
