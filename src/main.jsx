import React, { useEffect, useMemo, useState } from 'react'
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
const BATCHES = [2021, 2022, 2023, 2024, 2025]
const GENDERS = ['Male', 'Female']

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
  const [teamViewMode, setTeamViewMode] = useState('all')

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loginOpen, setLoginOpen] = useState(false)
  const [toast, setToast] = useState('')

  const [deletingBid, setDeletingBid] = useState(null)
  const [undoingSale, setUndoingSale] = useState(null)
  const [deletingPlayer, setDeletingPlayer] = useState(null)

  const [manualAddOpen, setManualAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  const [newBatch, setNewBatch] = useState(2024)
  const [newGender, setNewGender] = useState('Male')
  const [newRoll, setNewRoll] = useState('')
  const [newName, setNewName] = useState('')

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
      (_event, session) => {
        setSession(session)
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

    const [p, t, allResults] = await Promise.all([
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
    if (allResults.error) notify(allResults.error.message)

    setPools(p.data || [])
    setTeams(t.data || [])
    setAllHistory(allResults.data || [])

    if (p.data?.length) {
      setPool(
        prev =>
          prev ||
          p.data.find(
            x => x.batch_year === 2024 && x.gender === 'Male'
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

    if (state.data) setCurrent(state.data)

    setBalances(bal.data || [])
    setPlayers(ps.data || [])
    setHistory(hist.data || [])
    setBids(bidData.data || [])

    const { data: completeHistory, error: completeError } =
      await supabase
        .from('auction_results')
        .select('*, player:players(*), team:teams(*), pool:pools(*)')
        .order('created_at', { ascending: false })

    if (!completeError) {
      setAllHistory(completeHistory || [])
    }
  }

  function notify(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({
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
   * ADD PLAYER MANUALLY
   * =========================================================
   */

  async function addPlayerManually() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!newRoll.trim()) {
      notify('Enter roll number')
      return
    }

    if (!newName.trim()) {
      notify('Enter player name')
      return
    }

    const targetPool = pools.find(
      p =>
        p.batch_year === Number(newBatch) &&
        p.gender === newGender
    )

    if (!targetPool) {
      notify('That pool does not exist')
      return
    }

    const { data, error } = await supabase.rpc(
      'add_player_manual',
      {
        p_pool_id: targetPool.id,
        p_roll_number: newRoll.trim(),
        p_name: newName.trim()
      }
    )

    if (error) {
      notify(error.message)
      return
    }

    setNewRoll('')
    setNewName('')
    setManualAddOpen(false)

    notify(
      `${newName.trim()} added to ${poolLabel(targetPool)}`
    )

    if (pool?.id === targetPool.id) {
      await loadPool()
    } else {
      await loadBase()
      await loadPool()
    }

    return data
  }

  /*
   * =========================================================
   * CSV IMPORT
   * =========================================================
   */

  function parseCSV(text) {
    const lines = text
      .replace(/\r/g, '')
      .split('\n')
      .filter(line => line.trim())

    if (!lines.length) {
      throw new Error('CSV file is empty')
    }

    const headers = lines[0]
      .split(',')
      .map(x => x.trim().toLowerCase().replace(/\s+/g, '_'))

    const required = ['batch', 'gender', 'roll_number', 'name']

    for (const key of required) {
      if (!headers.includes(key)) {
        throw new Error(
          `Missing column "${key}". Required: batch, gender, roll_number, name`
        )
      }
    }

    const result = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',')

      const row = {}

      headers.forEach((header, index) => {
        row[header] = (values[index] || '').trim()
      })

      if (
        row.batch ||
        row.gender ||
        row.roll_number ||
        row.name
      ) {
        result.push({
          batch: row.batch,
          gender: row.gender,
          roll_number: row.roll_number,
          name: row.name
        })
      }
    }

    return result
  }

  async function importCSV(file) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (!file) return

    try {
      setImporting(true)

      const text = await file.text()
      const rows = parseCSV(text)

      if (!rows.length) {
        notify('No players found in CSV')
        setImporting(false)
        return
      }

      const { data, error } = await supabase.rpc(
        'import_players',
        {
          p_players: rows
        }
      )

      if (error) {
        notify(error.message)
        setImporting(false)
        return
      }

      notify(
        `Import complete • ${data?.added ?? 0} added • ${data?.skipped ?? 0} skipped`
      )

      setImportOpen(false)
      await loadPool()
    } catch (err) {
      notify(err.message || 'Could not read CSV')
    }

    setImporting(false)
  }

  /*
   * =========================================================
   * DELETE PLAYER
   * =========================================================
   */

  async function deletePlayer(player) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (player.status === 'sold') {
      notify('Undo the sale before deleting this player')
      return
    }

    if (player.status === 'live') {
      notify('You cannot delete the live player')
      return
    }

    const confirmed = window.confirm(
      `Delete ${player.name} (${player.roll_number})?\n\nThis removes the player from the Players list.`
    )

    if (!confirmed) return

    setDeletingPlayer(player.id)

    /*
     * This uses the delete_player RPC from your existing setup.
     */
    const { error } = await supabase.rpc(
      'delete_player',
      {
        p_player_id: player.id
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

  /*
   * =========================================================
   * AUCTION
   * =========================================================
   */

  async function startExistingPlayer(playerId) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (current?.current_player_id) {
      notify('Finish the current player first')
      return
    }

    const { error } = await supabase.rpc(
      'start_existing_player',
      {
        p_player_id: playerId
      }
    )

    if (error) {
      notify(error.message)
    } else {
      notify('Player is LIVE')
      await loadPool()
    }
  }

  async function startPlayer() {
    if (!session) {
      setLoginOpen(true)
      return
    }

    if (current?.current_player_id) {
      notify('Finish the current player first')
      return
    }

    const available = players.filter(
      p => p.status === 'available'
    )

    if (!available.length) {
      notify(`No available players in ${poolLabel(pool)}`)
      return
    }

    const options = available
      .map(
        (p, i) =>
          `${i + 1}. ${p.roll_number} — ${p.name}`
      )
      .join('\n')

    const answer = window.prompt(
      `Select player number:\n\n${options}\n\nEnter number:`
    )

    if (!answer) return

    const index = Number(answer) - 1

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= available.length
    ) {
      notify('Invalid player number')
      return
    }

    await startExistingPlayer(available[index].id)
  }

  async function bid(teamName) {
    if (!current?.current_player_id) return

    const team = teamMap[teamName]
    if (!team) return

    const firstBid = current.leader_team_id == null

    /*
     * IMPORTANT:
     * First bid is exactly 3 EP.
     */
    const amount = firstBid
      ? 3
      : nextBid(current.current_bid)

    const { error } = await supabase.rpc(
      'place_bid',
      {
        p_pool_id: pool.id,
        p_team_id: team.id
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

    const { error } = await supabase.rpc(
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

    const { error } = await supabase.rpc(
      'mark_unsold',
      {
        p_pool_id: pool.id
      }
    )

    if (error) {
      notify(error.message)
    } else {
      notify('Player UNSOLD')
      await loadPool()
    }
  }

  async function relist(id) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const { error } = await supabase.rpc(
      'relist_player',
      {
        p_player_id: id
      }
    )

    if (error) {
      notify(error.message)
    } else {
      notify('Player brought back at 3 EP')
      await loadPool()
    }
  }

  /*
   * =========================================================
   * BID UNDO
   * =========================================================
   */

  async function deleteBid(id) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const confirmed = window.confirm(
      'Delete this bid?\n\nOnly this bid will be removed.'
    )

    if (!confirmed) return

    setDeletingBid(id)

    const { error } = await supabase.rpc(
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
          b.player_id === current.current_player_id
      )
      .sort((a, b) => {
        const diff =
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()

        return diff !== 0
          ? diff
          : Number(a.id) - Number(b.id)
      })

    const lastBid =
      playerBids[playerBids.length - 1]

    if (!lastBid) {
      notify('There are no bids to undo')
      return
    }

    await deleteBid(lastBid.id)
  }

  /*
   * =========================================================
   * UNDO SALE
   * =========================================================
   */

  async function undoSoldPlayer(resultId) {
    if (!session) {
      setLoginOpen(true)
      return
    }

    const result = history.find(
      x => x.id === resultId
    )

    if (!result || result.status !== 'SOLD') {
      notify('Only SOLD players can be undone')
      return
    }

    const confirmed = window.confirm(
      `Undo the sale of ${
        result.player?.name || 'this player'
      }?\n\nTeam: ${
        result.team?.name || 'Unknown'
      }\nRefund: ${
        result.final_price
      } EP\n\nThe player will be removed from the squad and returned to AVAILABLE.`
    )

    if (!confirmed) return

    setUndoingSale(resultId)

    const { error } = await supabase.rpc(
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

  const selectedBalance = name =>
    balances.find(
      x =>
        x.team_id ===
        teamMap[name]?.id
    )?.remaining_ep ?? 150

  /*
   * FIRST BID = 3
   */
  const nextBid = b => {
    if (b === 3) return 4
    if (b < 10) return b + 1
    if (b < 20) return b + 2
    return b + 5
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
            const diff =
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()

            return diff !== 0
              ? diff
              : Number(a.id) - Number(b.id)
          })
      : []

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

  /*
   * =========================================================
   * AUCTION PAGE
   * =========================================================
   */

  function auction() {
    const c = current

    const availablePlayers = players.filter(
      p => p.status === 'available'
    )

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
              No timer • Admin-controlled bidding • Real-time Supabase sync
            </div>
          </div>

          <select
            className="select"
            value={pool?.id || ''}
            onChange={e => {
              setSelectedTeam(null)

              setPool(
                pools.find(
                  x => x.id === e.target.value
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
                {c?.current_player?.roll_number || '—'}
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
                  {TEAM_NAMES.map(name => {
                    const isFirstBid =
                      !c?.leader_team_id

                    const amount = isFirstBid
                      ? 3
                      : nextBid(
                          c?.current_bid ?? 3
                        )

                    return (
                      <button
                        className="teamBtn"
                        key={name}
                        disabled={
                          !c?.current_player ||
                          selectedBalance(name) <
                            amount
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
                          Bid {amount} EP
                        </small>
                      </button>
                    )
                  })}
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
                    onClick={startPlayer}
                    disabled={
                      !!c?.current_player
                    }
                  >
                    NEXT PLAYER
                  </button>
                </div>

                <div
                  className="card"
                  style={{
                    marginTop: '16px'
                  }}
                >
                  <div className="eyebrow">
                    AVAILABLE PLAYERS
                  </div>

                  <div className="teamPool">
                    {availablePlayers.length}{' '}
                    available in {poolLabel(pool)}
                  </div>

                  {availablePlayers.length === 0 ? (
                    <div className="notice">
                      No available players.
                      Add players from the Players menu.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        marginTop: '12px'
                      }}
                    >
                      {availablePlayers.map(p => (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 12px',
                            border: '1px solid rgba(255,255,255,.1)',
                            borderRadius: '10px'
                          }}
                        >
                          <div>
                            <strong>
                              {p.roll_number} — {p.name}
                            </strong>
                          </div>

                          <button
                            className="btn primary"
                            onClick={() =>
                              startExistingPlayer(p.id)
                            }
                          >
                            Start Auction
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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
                      {c.current_player.name} • Bid History
                    </div>

                    {currentPlayerBids.length === 0 ? (
                      <div className="notice">
                        No bids yet. Player is open at 3 EP.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            marginTop: '12px'
                          }}
                        >
                          {currentPlayerBids.map(b => (
                            <div
                              key={b.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '10px 12px',
                                border: '1px solid rgba(255,255,255,.1)',
                                borderRadius: '10px'
                              }}
                            >
                              <div>
                                <strong>
                                  {b.team?.name ||
                                    'Unknown Team'}
                                </strong>

                                <div
                                  className="sub"
                                  style={{
                                    marginTop: '2px'
                                  }}
                                >
                                  {b.amount} EP
                                </div>
                              </div>

                              <button
                                className="danger"
                                disabled={
                                  deletingBid === b.id
                                }
                                onClick={() =>
                                  deleteBid(b.id)
                                }
                              >
                                {deletingBid === b.id
                                  ? 'Deleting…'
                                  : '🗑 Delete'}
                              </button>
                            </div>
                          ))}
                        </div>

                        <div
                          className="actions"
                          style={{
                            marginTop: '12px'
                          }}
                        >
                          <button
                            className="danger"
                            onClick={undoLastBid}
                            disabled={
                              currentPlayerBids.length === 0 ||
                              deletingBid !== null
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
                    balance={selectedBalance(name)}
                    onClick={() => {
                      setSelectedTeam(name)
                      setTeamViewMode('current')
                      setPage('teams')
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </>
    )
  }

  /*
   * =========================================================
   * PLAYERS PAGE
   * =========================================================
   */

  function playersPage() {
    const filteredPlayers = players.filter(
      p => p.pool_id === pool?.id
    )

    return (
      <>
        <div className="sectionhead">
          <div>
            <div className="eyebrow">
              PLAYER MANAGEMENT
            </div>

            <div className="title">
              PLAYERS
            </div>

            <div className="sub">
              Only players belonging to the selected pool are shown.
            </div>
          </div>

          {mode === 'admin' && (
            <div className="actions">
              <button
                className="btn primary"
                onClick={() =>
                  setManualAddOpen(true)
                }
              >
                ➕ Add Player Manually
              </button>

              <button
                className="btn"
                onClick={() =>
                  setImportOpen(true)
                }
              >
                📥 Import Players
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="eyebrow">
            SELECT POOL
          </div>

          <select
            className="select"
            style={{
              marginTop: '10px',
              width: '100%',
              maxWidth: '350px'
            }}
            value={pool?.id || ''}
            onChange={e => {
              const selected = pools.find(
                p => p.id === e.target.value
              )

              if (selected) {
                setPool(selected)
              }
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

          <div
            className="notice"
            style={{
              marginTop: '16px'
            }}
          >
            Showing <b>{filteredPlayers.length}</b>{' '}
            players from <b>{poolLabel(pool)}</b>.
          </div>
        </div>

        <div
          className="card"
          style={{
            marginTop: '16px'
          }}
        >
          <div className="eyebrow">
            {poolLabel(pool)} PLAYERS
          </div>

          {filteredPlayers.length === 0 ? (
            <div className="notice">
              No players have been added to this pool yet.
            </div>
          ) : (
            <div
              style={{
                overflowX: 'auto',
                marginTop: '12px'
              }}
            >
              <table className="table">
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredPlayers.map(p => (
                    <tr key={p.id}>
                      <td>{p.roll_number}</td>

                      <td>{p.name}</td>

                      <td>
                        <span
                          style={{
                            textTransform: 'uppercase'
                          }}
                        >
                          {p.status}
                        </span>
                      </td>

                      <td>
                        {mode === 'admin' &&
                        p.status !== 'sold' &&
                        p.status !== 'live' ? (
                          <button
                            className="danger"
                            disabled={
                              deletingPlayer === p.id
                            }
                            onClick={() =>
                              deletePlayer(p)
                            }
                          >
                            {deletingPlayer === p.id
                              ? 'Deleting…'
                              : '🗑 Delete'}
                          </button>
                        ) : p.status === 'sold' ? (
                          <span className="sub">
                            Undo sale first
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {manualAddOpen && (
          <div className="modal">
            <div className="modalCard">
              <div className="title">
                Add Player Manually
              </div>

              <div className="sub">
                The player will be added as AVAILABLE.
              </div>

              <label className="sub">
                Batch
              </label>

              <select
                className="field"
                value={newBatch}
                onChange={e =>
                  setNewBatch(Number(e.target.value))
                }
              >
                {BATCHES.map(b => (
                  <option
                    key={b}
                    value={b}
                  >
                    {b}
                  </option>
                ))}
              </select>

              <label className="sub">
                Gender
              </label>

              <select
                className="field"
                value={newGender}
                onChange={e =>
                  setNewGender(e.target.value)
                }
              >
                {GENDERS.map(g => (
                  <option
                    key={g}
                    value={g}
                  >
                    {g}
                  </option>
                ))}
              </select>

              <input
                className="field"
                placeholder="Roll number"
                value={newRoll}
                onChange={e =>
                  setNewRoll(e.target.value)
                }
              />

              <input
                className="field"
                placeholder="Player name"
                value={newName}
                onChange={e =>
                  setNewName(e.target.value)
                }
              />

              <div className="notice">
                Pool: <b>{newBatch} • {newGender}</b>
              </div>

              <div className="actions">
                <button
                  className="btn"
                  onClick={() =>
                    setManualAddOpen(false)
                  }
                >
                  Cancel
                </button>

                <button
                  className="btn primary"
                  onClick={addPlayerManually}
                >
                  Add Player
                </button>
              </div>
            </div>
          </div>
        )}

        {importOpen && (
          <div className="modal">
            <div className="modalCard">
              <div className="title">
                📥 Import Players
              </div>

              <div className="sub">
                Upload a CSV exported from Google Sheets.
              </div>

              <div
                className="notice"
                style={{
                  marginTop: '14px',
                  lineHeight: 1.6
                }}
              >
                <b>Required columns:</b>
                <br />
                batch, gender, roll_number, name
                <br /><br />

                <b>Example:</b>
                <br />
                2024, Male, 01, Rahul Kumar
                <br />
                2024, Male, 02, Arjun Reddy
                <br />
                2024, Female, 01, Priya Sharma
              </div>

              <input
                className="field"
                type="file"
                accept=".csv,text/csv"
                style={{
                  marginTop: '16px'
                }}
                disabled={importing}
                onChange={e => {
                  const file =
                    e.target.files?.[0]

                  if (file) {
                    importCSV(file)
                  }

                  e.target.value = ''
                }}
              />

              {importing && (
                <div className="notice">
                  Importing players…
                </div>
              )}

              <div className="actions">
                <button
                  className="btn"
                  disabled={importing}
                  onClick={() =>
                    setImportOpen(false)
                  }
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  /*
   * =========================================================
   * TEAMS PAGE
   * =========================================================
   */

  function teamsPage() {
    if (selectedTeam) {
      const currentPoolPlayers =
        currentPoolTeamPlayers(selectedTeam)

      const allPlayers =
        allPoolTeamPlayers(selectedTeam)

      const displayedPlayers =
        teamViewMode === 'current'
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
                {teamViewMode === 'current'
                  ? `Players from ${poolLabel(pool)}`
                  : 'Players from all pools'}
              </div>
            </div>

            <button
              className="btn"
              onClick={() =>
                setSelectedTeam(null)
              }
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
                teamViewMode === 'current'
                  ? 'btn primary'
                  : 'btn'
              }
              onClick={() =>
                setTeamViewMode('current')
              }
            >
              Current Pool
            </button>

            <button
              className={
                teamViewMode === 'all'
                  ? 'btn primary'
                  : 'btn'
              }
              onClick={() =>
                setTeamViewMode('all')
              }
            >
              All Pools
            </button>
          </div>

          <div className="card">
            <div className="eyebrow">
              {selectedTeam} •{' '}
              {teamViewMode === 'current'
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
              {displayedPlayers.length === 1
                ? ''
                : 's'}
            </div>

            {displayedPlayers.length === 0 ? (
              <div className="notice">
                No players purchased by{' '}
                {selectedTeam}{' '}
                {teamViewMode === 'current'
                  ? `in ${poolLabel(pool)}`
                  : 'across any pool'}.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    {teamViewMode === 'all' && (
                      <th>Pool</th>
                    )}

                    <th>Player</th>
                    <th>Price</th>
                  </tr>
                </thead>

                <tbody>
                  {displayedPlayers.map(x => (
                    <tr key={x.id}>
                      {teamViewMode === 'all' && (
                        <td>
                          {x.pool
                            ? poolLabel(x.pool)
                            : '—'}
                        </td>
                      )}

                      <td>
                        {x.player?.roll_number} —{' '}
                        {x.player?.name}
                      </td>

                      <td>
                        {x.final_price} EP
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
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
              allPoolTeamPlayers(name).length

            return (
              <button
                key={name}
                className="stat"
                onClick={() => {
                  setSelectedTeam(name)
                  setTeamViewMode('all')
                }}
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

  /*
   * =========================================================
   * HISTORY
   * =========================================================
   */

  function historyPage() {
    return (
      <>
        <Header
          eyebrow="COMPLETE LIST"
          title="AUCTION HISTORY"
          sub="Sold and unsold records from Supabase."
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
                    {x.player?.roll_number} —{' '}
                    {x.player?.name}
                  </td>

                  <td>{x.status}</td>

                  <td>
                    {x.team?.name || '—'}
                  </td>

                  <td>
                    {x.final_price
                      ? `${x.final_price} EP`
                      : '—'}
                  </td>

                  {mode === 'admin' && (
                    <td>
                      {x.status === 'SOLD' ? (
                        <button
                          className="danger"
                          disabled={
                            undoingSale === x.id
                          }
                          onClick={() =>
                            undoSoldPlayer(x.id)
                          }
                        >
                          {undoingSale === x.id
                            ? 'Undoing…'
                            : '↩ Undo Sale'}
                        </button>
                      ) : (
                        <button
                          className="btn"
                          onClick={() =>
                            relist(x.player_id)
                          }
                        >
                          ↩ Relist
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

  /*
   * =========================================================
   * POOLS
   * =========================================================
   */

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
            <button
              className="stat"
              key={p.id}
              style={{
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onClick={() => {
                setPool(p)
                setSelectedTeam(null)
                setPage('players')
              }}
            >
              <span>
                {poolLabel(p)}
              </span>

              <b>
                5 × 150 EP
              </b>

              <small>
                Click to view players →
              </small>
            </button>
          ))}
        </div>
      </>
    )
  }

  /*
   * =========================================================
   * MAIN LAYOUT
   * =========================================================
   */

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
              active={page === 'auction'}
              onClick={() => {
                setSelectedTeam(null)
                setPage('auction')
              }}
            >
              🔴 Live Auction
            </Nav>

            <Nav
              active={page === 'players'}
              onClick={() => {
                setSelectedTeam(null)
                setPage('players')
              }}
            >
              👤 Players
            </Nav>

            <Nav
              active={page === 'teams'}
              onClick={() => {
                setSelectedTeam(null)
                setPage('teams')
              }}
            >
              🏆 Teams
            </Nav>

            <Nav
              active={page === 'history'}
              onClick={() => {
                setSelectedTeam(null)
                setPage('history')
              }}
            >
              📜 Auction History
            </Nav>

            <Nav
              active={page === 'pools'}
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

/*
 * ===========================================================
 * COMPONENTS
 * ===========================================================
 */

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
                (balance / 150) * 100
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
          Only authenticated admins can run the auction.
        </div>

        <input
          className="field"
          placeholder="Admin email"
          value={email}
          onChange={e =>
            setEmail(e.target.value)
          }
        />

        <input
          className="field"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e =>
            setPassword(e.target.value)
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
          Euphoria is ready for Supabase
        </div>

        <p className="sub">
          Add VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY to your
          Vercel environment variables,
          run the supplied SQL in Supabase,
          then redeploy.
        </p>
      </div>
    </div>
  )
}

createRoot(
  document.getElementById('root')
).render(<App />)
